import EventEmitter from 'node:events'
import net from 'net'
import { generatePrelude } from './prelude.js'
import { generateConfigure } from './configure.js'

const CONFIGURE_PORT = 9991
const CONFIGURE_TIMEOUT = 5000

interface SocketWrapper {
	client: net.Socket
	configure: net.Socket | undefined
	deviceInfo: Record<string, any>
	publicClientId: string
}

export interface VideohubServerOptions {
	manualConfigure?: boolean
}

export interface ConfigureOptions {
	destinationCount: number
}

export class VideohubServer extends EventEmitter {
	/**
	 * Listening server
	 */
	#server: net.Server

	/**
	 * Connected clients
	 */
	#clients: Record<string, SocketWrapper> = {}

	#manualConfigureClients = false

	#isRunning = false

	constructor(options: VideohubServerOptions = {}) {
		super()

		this.#server = net.createServer(this.#clientConnect.bind(this))
		this.#manualConfigureClients = !!options.manualConfigure
	}

	/**
	 * Start listening for clients
	 * @param host - default '0.0.0.0'
	 * @param port - default 9990
	 */
	start(host?: string, port?: number): void {
		if (this.#isRunning) return
		this.#isRunning = true

		this.#server.on('error', (err) => this.emit('error', err))

		this.#server.listen(port || 9990, host, () => {
			this.emit('debug', `listening on port ${port || 9990}`)
		})
	}

	destroy(): void {
		if (!this.#isRunning) return
		this.#isRunning = false

		// Stop the server from accepting new clients
		this.#server.close()

		// Close all open clients
		for (const client of Object.values(this.#clients)) {
			client.client.destroy()
			if (client.configure) client.configure.destroy()
		}

		this.#server.removeAllListeners()
	}

	#clientConnect(socket: net.Socket) {
		const { remoteAddress, remotePort } = socket
		if (!remoteAddress || !remotePort) {
			// Socket looks already closed
			socket.destroy()
			return
		}

		const internalClientId = `${remoteAddress}:${remotePort}`
		let publicClientId = remoteAddress
		const clientWrapper: SocketWrapper = {
			client: socket,
			configure: undefined,
			deviceInfo: {},
			publicClientId,
		}
		this.#clients[internalClientId] = clientWrapper

		const doCleanup = () => {
			socket.removeAllListeners('data')
			socket.removeAllListeners('close')

			this.emit('debug', 'lost client', internalClientId, publicClientId)
			if (clientWrapper.configure) clientWrapper.configure.destroy()
			delete this.#clients[internalClientId]
			this.emit('disconnect', publicClientId)
		}

		socket.setTimeout(20000)
		socket.on('timeout', () => {
			this.emit('debug', 'socket timeout', internalClientId, publicClientId)
			socket.end()
			doCleanup()
		})

		socket.on('error', (err) => {
			this.emit('error', 'socket error', internalClientId, publicClientId, err)
			socket.end()
			doCleanup()
		})

		socket.on('close', doCleanup)

		this.emit('debug', 'new client', internalClientId, publicClientId)

		let dataBuffer = ''
		socket.on('data', (data) => {
			dataBuffer += data.toString()

			const splitIndex = dataBuffer.indexOf('\n\n')
			if (splitIndex != -1) {
				const toProcess = dataBuffer.slice(0, splitIndex).split('\n')
				dataBuffer = dataBuffer.slice(splitIndex + 2)

				if (toProcess.length > 0) {
					this.#handleCommands(socket, publicClientId, toProcess)
				}
			}
		})

		// Send the prelude
		socket.write(generatePrelude())

		this.#connectConfigure(remoteAddress)
			.then(([configureSocket, processedInfo]) => {
				clientWrapper.configure = configureSocket
				clientWrapper.deviceInfo = processedInfo
				publicClientId = processedInfo.id || publicClientId
				clientWrapper.publicClientId = publicClientId

				configureSocket.on('close', () => {
					// Kill the primary socket
					socket.destroy()
				})

				if (!this.#manualConfigureClients) {
					// Configure the device
					configureSocket.write(generateConfigure(processedInfo.buttonsColumns, processedInfo.buttonsRows))
				}

				// It is ready for use
				this.emit('connect', publicClientId, processedInfo, remoteAddress)
			})
			.catch((err) => {
				// Something went wrong, kill it
				socket.destroy()
				this.emit('debug', 'configure failed', remoteAddress, err)
				// TODO - emit error?
			})
	}

	async #connectConfigure(remoteAddress: string): Promise<[net.Socket, Record<string, any>]> {
		const socket = net.connect(CONFIGURE_PORT, remoteAddress)
		socket.setTimeout(20000)

		socket.on('error', (err) => {
			// 'handle' the error
			this.emit('debug', 'configure error', remoteAddress, err)
		})

		let killed = false

		const timeout = setTimeout(() => {
			// Give the configuration a hard timeout, to avoid getting stuck
			killed = true
			this.emit('debug', 'configure timeout', remoteAddress)
			socket.destroy()
			socket.removeAllListeners()
		}, CONFIGURE_TIMEOUT)

		try {
			// Wait for the connection to open or fail
			await Promise.race([
				new Promise((resolve) => socket.once('connect', resolve)),
				new Promise((resolve) => socket.once('timeout', resolve)),
				new Promise((resolve) => socket.once('close', resolve)),
				new Promise((resolve) => socket.once('error', resolve)),
			])

			if (killed) throw new Error('Timeout')

			this.emit('debug', 'configure opened', remoteAddress)

			let deviceInfo: string[] = []
			// Receive the lines about the device
			await new Promise((resolve) => {
				let dataBuffer = ''
				const handler = (data: Buffer) => {
					dataBuffer += data.toString()

					const splitIndex = dataBuffer.indexOf('\n\n')
					if (splitIndex != -1) {
						const toProcess = dataBuffer.slice(0, splitIndex).split('\n')
						dataBuffer = dataBuffer.slice(splitIndex + 2)

						// console.log('config', data, data.toString())
						if (toProcess.length > 0) {
							if (toProcess[0] === 'SMART DEVICE:') {
								deviceInfo = toProcess

								socket.off('data', handler)
								resolve(null)
							}
						}
					}
				}
				socket.on('data', handler)
			})

			// Parse the deviceInfo
			this.emit('debug', 'configure info', remoteAddress, deviceInfo)

			const processedInfo: Record<string, any> = {}
			for (let i = 1; i < deviceInfo.length; i++) {
				const element = deviceInfo[i]
				const splitIndex = element.indexOf(':')
				const key = element.slice(0, splitIndex)
				const value = element.slice(splitIndex + 1).trim()

				switch (key) {
					case 'Model':
						processedInfo.model = value
						break
					case 'Label':
						processedInfo.name = value
						break
					case 'Unique ID':
						processedInfo.id = value
						break
					case 'Input count':
						processedInfo.buttonsTotal = Number(value)
						break
					case 'Inputs across':
						processedInfo.buttonsColumns = Number(value)
						break
					case 'Inputs down':
						processedInfo.buttonsRows = Number(value)
						break
				}
			}

			this.emit('debug', 'configure ready', remoteAddress, processedInfo)

			return [socket, processedInfo]
		} catch (e) {
			socket.destroy()
			socket.removeAllListeners()

			throw e
		} finally {
			clearTimeout(timeout)
		}
	}

	#handleCommands(socket: net.Socket, remoteAddress: string, lines: string[]) {
		this.emit('debug', remoteAddress, lines)

		// Always ACK the command
		socket.write('ACK\n\n')

		if (lines.length === 1 && lines[0] === 'PING:') {
			// Simply ack it
		} else if (lines.length > 1 && lines[0] === 'VIDEO OUTPUT ROUTING:') {
			let displayPress
			for (let i = 1; i < lines.length; i++) {
				const line = lines[i]
				const parts = line.split(' ')
				const destination = Number(parts[0])
				const value = Number(parts[1])
				if (!isNaN(destination) && !isNaN(value)) {
					displayPress = value
					this.emit('press', remoteAddress, destination, value)
				}
			}

			// If only one thing was triggered, flash the button
			if (lines.length === 2 && displayPress !== undefined) {
				// TODO
			}
		} else {
			// Unknown command, ignore it
		}
	}

	/**
	 * Set the backlight level of a connected panel
	 */
	setBacklight(publicClientId: string, backlight: number): void {
		backlight = Math.floor(backlight)
		if (typeof backlight !== 'number' || isNaN(backlight) || backlight < 0 || backlight > 10) {
			throw new Error(`Invalid backlight value: "${backlight}"`)
		}

		const client = Object.values(this.#clients).find(
			(cl) => cl.client.remoteAddress === publicClientId || cl.publicClientId === publicClientId,
		)
		if (!client || !client.client.remoteAddress) throw new Error(`Unknown client: ${publicClientId}`)

		if (!client.configure) throw new Error(`Unavailable for configuration: ${publicClientId}`)

		let payload = 'SETTINGS:\n'
		payload += `Backlight: ${backlight}\n`
		payload += `Destination backlight: ${backlight}\n`
		payload += '\n'

		client.configure.write(payload)
	}

	/**
	 * Configure a connected panel
	 */
	configureDevice(publicClientId: string, options: ConfigureOptions): void {
		const destinationCount = Math.floor(options.destinationCount)
		if (
			typeof destinationCount !== 'number' ||
			isNaN(destinationCount) ||
			destinationCount < 0 ||
			destinationCount > 8 ||
			destinationCount % 2 !== 0
		) {
			throw new Error(`Invalid destination count: "${destinationCount}"`)
		}

		const client = Object.values(this.#clients).find(
			(cl) => cl.client.remoteAddress === publicClientId || cl.publicClientId === publicClientId,
		)
		if (!client || !client.client.remoteAddress) throw new Error(`Unknown client: ${publicClientId}`)

		if (!client.configure) throw new Error(`Unavailable for configuration: ${publicClientId}`)

		client.configure.write(
			generateConfigure(client.deviceInfo.buttonsColumns, client.deviceInfo.buttonsRows, destinationCount),
		)
	}
}
