import {
	createModuleLogger,
	type DiscoveredSurfaceInfo,
	type SurfacePluginDetection,
	type SurfacePluginDetectionEvents,
	type OpenSurfaceResult,
	type SurfaceContext,
	type SurfacePlugin,
} from '@companion-surface/base'
import { VideohubPanelWrapper } from './instance.js'
import { createSurfaceSchema } from './surface-schema.js'
import { VideohubServer } from './server/videohub.js'
import EventEmitter from 'node:events'

const logger = createModuleLogger('Plugin')

export interface SurfaceInfo {
	address: string
	panelInfo: {
		id: string
		buttonsColumns: number
		buttonsRows: number

		model?: string
	}
}

class VideohubPanelListener
	extends EventEmitter<SurfacePluginDetectionEvents<SurfaceInfo>>
	implements SurfacePluginDetection<SurfaceInfo>
{
	server: VideohubServer | null = null

	readonly configFields = []
	readonly checkConfigMatchesExpression = null

	// Track connected surfaces to handle disconnections properly
	readonly #connectedSurfaces = new Map<string, DiscoveredSurfaceInfo<SurfaceInfo>>()

	// Store bound methods for proper event listener cleanup
	readonly boundConnectPanel = this.connectPanel.bind(this)
	readonly boundDisconnectPanel = this.disconnectPanel.bind(this)

	async triggerScan(): Promise<void> {
		// Not supported
	}

	rejectSurface(_surfaceInfo: DiscoveredSurfaceInfo<SurfaceInfo>): void {
		// Not supported
	}

	/**
	 * Panel connected
	 */
	connectPanel(id: string, info: SurfaceInfo['panelInfo'], remoteAddress: string): void {
		info.id = id // Ensure id is in sync

		const fullId = `videohub:${id}`
		logger.info(`Panel "${fullId}" connected from ${remoteAddress}`)

		const surfaceInfo: DiscoveredSurfaceInfo<SurfaceInfo> = {
			surfaceId: fullId,
			description: `Videohub ${info.model}`,
			pluginInfo: {
				address: remoteAddress,
				panelInfo: info,
			},
		}

		// Track the connected surface
		this.#connectedSurfaces.set(fullId, surfaceInfo)

		this.emit('surfacesAdded', [surfaceInfo])
	}

	/**
	 * Panel disconnected
	 */
	disconnectPanel(id: string): void {
		const fullId = `videohub:${id}`
		logger.info(`Panel "${fullId}" disconnected`)

		// Check if we have this surface tracked
		const surfaceInfo = this.#connectedSurfaces.get(fullId)
		if (surfaceInfo) {
			// Remove from tracking
			this.#connectedSurfaces.delete(fullId)

			// The surface disconnect will be handled by the individual surface instance
			// through the disconnect handler in VideohubPanelWrapper
		}
	}

	/**
	 * Clear all connected surfaces - used during cleanup
	 */
	clearConnectedSurfaces(): void {
		this.#connectedSurfaces.clear()
	}
}

class BlackmagicVideohubPanelPlugin implements SurfacePlugin<SurfaceInfo> {
	// Note: using detection instead of remote is weird, but we recieve connections instead of making them so this keeps things simpler
	detection = new VideohubPanelListener()

	async init(): Promise<void> {
		if (!this.detection.server)
			this.detection.server = new VideohubServer({
				manualConfigure: true,
			})

		this.detection.server.on('error', (e: any) => {
			logger.debug(`listen-socket error: ${e}`)
		})
		this.detection.server.on('connect', this.detection.boundConnectPanel)
		this.detection.server.on('disconnect', this.detection.boundDisconnectPanel)

		this.detection.server.start()
	}
	async destroy(): Promise<void> {
		if (this.detection.server) {
			// Remove all event listeners from the server to prevent memory leaks
			this.detection.server.off('connect', this.detection.boundConnectPanel)
			this.detection.server.off('disconnect', this.detection.boundDisconnectPanel)

			this.detection.server.destroy()
			this.detection.server = null
		}

		// Clear the connected surfaces map
		this.detection.clearConnectedSurfaces()
	}

	async openSurface(surfaceId: string, pluginInfo: SurfaceInfo, context: SurfaceContext): Promise<OpenSurfaceResult> {
		logger.debug(`Opening panel: ${pluginInfo.address} (${surfaceId})`)

		if (!this.detection.server) throw new Error('Server not running')

		return {
			surface: new VideohubPanelWrapper(surfaceId, this.detection.server, pluginInfo, context),
			registerProps: {
				brightness: true,
				surfaceLayout: createSurfaceSchema(pluginInfo),
				pincodeMap: null,
				location: null,
			},
		}
	}
}

export default new BlackmagicVideohubPanelPlugin()
