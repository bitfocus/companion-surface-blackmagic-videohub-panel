import type { SurfaceSchemaLayoutDefinition } from '@companion-surface/base'
import type { SurfaceInfo } from './main.js'

export function createSurfaceSchema(info: SurfaceInfo): SurfaceSchemaLayoutDefinition {
	const surfaceLayout: SurfaceSchemaLayoutDefinition = {
		stylePresets: {
			default: {},
		},
		controls: {},
	}

	for (let row = 0; row < info.panelInfo.buttonsRows; row++) {
		for (let col = 0; col < info.panelInfo.buttonsColumns; col++) {
			surfaceLayout.controls[`${row}/${col}`] = {
				row: row,
				column: col,
			}
		}
	}

	return surfaceLayout
}
