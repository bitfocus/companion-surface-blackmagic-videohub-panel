import {
	CardGenerator,
	HostCapabilities,
	SurfaceDrawProps,
	SurfaceContext,
	SurfaceInstance,
	createModuleLogger,
	ModuleLogger,
} from '@companion-surface/base'
import debounce from 'debounce-fn'
import type { VideohubServer } from './server/videohub.js'
import type { SurfaceInfo } from './main.js'

export class VideohubPanelWrapper implements SurfaceInstance {
	readonly #logger: ModuleLogger

	readonly #surfaceId: string
	readonly #server: VideohubServer
	readonly #info: SurfaceInfo
	readonly #context: SurfaceContext

	readonly #pressHandler = (clientId: string, _destination: number, button: number) => {
		if (clientId !== this.#info.panelInfo.id) return

		const { buttonsColumns, buttonsRows } = this.#info.panelInfo
		const row = Math.floor(button / buttonsColumns)
		const col = button % buttonsColumns
		if (row < 0 || row >= buttonsRows || col < 0 || col >= buttonsColumns) {
			this.#logger.warn(`Button index out of range: button=${button}, row=${row}, col=${col}`)
			return
		}

		const controlId = `${row}/${col}`
		this.#logger.debug(`Button press: ${controlId} (button: ${button})`)
		this.#context.keyDownUpById(controlId) // TODO - pageOffset
	}

	readonly #disconnectHandler = (clientId: string) => {
		if (clientId !== this.#info.panelInfo.id) return

		this.#logger.info(`Panel disconnected from ${this.#info.address}`)
		this.#context.disconnect(new Error('Panel disconnected'))
	}

	public get surfaceId(): string {
		return this.#surfaceId
	}
	public get productName(): string {
		return `Videohub ${this.#info.panelInfo.model || 'Panel'}`
	}

	public constructor(surfaceId: string, server: VideohubServer, info: SurfaceInfo, context: SurfaceContext) {
		this.#logger = createModuleLogger(`Videohub/${surfaceId}`)
		this.#surfaceId = surfaceId
		this.#server = server
		this.#info = info
		this.#context = context

		// Set up event listeners for this specific surface
		this.#logger.info(
			`Initializing surface for ${this.#info.panelInfo.buttonsColumns}x${this.#info.panelInfo.buttonsRows} panel at ${this.#info.address}`,
		)
		this.#server.on('press', this.#pressHandler)
		this.#server.on('disconnect', this.#disconnectHandler)
	}

	// Debounced brightness setter to avoid flooding the device with brightness changes
	readonly #debouncedSetBrightness = debounce(
		(percent: number) => {
			this.#server.setBacklight(this.#info.panelInfo.id, percent / 10)
		},
		{
			wait: 50,
			maxWait: 100,
		},
	)

	async init(): Promise<void> {
		// Nothing to do?
	}
	async close(): Promise<void> {
		this.#logger.info('Closing surface and cleaning up event listeners')
		// Remove event listeners to prevent memory leaks
		this.#server.off('press', this.#pressHandler)
		this.#server.off('disconnect', this.#disconnectHandler)
	}

	updateCapabilities(_capabilities: HostCapabilities): void {
		// Not used
	}

	async ready(): Promise<void> {}

	async setBrightness(percent: number): Promise<void> {
		this.#debouncedSetBrightness(percent)
	}
	async blank(): Promise<void> {
		// Not supported
	}
	async draw(_signal: AbortSignal, _drawProps: SurfaceDrawProps): Promise<void> {
		// Not supported
	}

	async showStatus(_signal: AbortSignal, _cardGenerator: CardGenerator): Promise<void> {
		// Nothing to display here
		// TODO - do some flashing lights to indicate each status?
	}
}
