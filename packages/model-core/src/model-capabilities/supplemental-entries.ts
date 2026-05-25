import type { ModelCapabilitiesSnapshotEntry } from "./types"

export const SUPPLEMENTAL_MODEL_CAPABILITIES: Record<string, ModelCapabilitiesSnapshotEntry> = {
	"kimi-k2.6": {
		id: "kimi-k2.6",
		family: "kimi",
		reasoning: true,
		temperature: true,
		toolCall: true,
		modalities: {
			input: ["text", "image", "video"],
			output: ["text"],
		},
		limit: {
			context: 262144,
			output: 262144,
		},
	},
	"gpt-5.5": {
		id: "gpt-5.5",
		family: "gpt",
		reasoning: true,
		temperature: false,
		toolCall: true,
		modalities: {
			input: ["text", "image", "pdf"],
			output: ["text"],
		},
		limit: {
			context: 400000,
			input: 272000,
			output: 128000,
		},
	},
	"gpt-5.4-mini-fast": {
		id: "gpt-5.4-mini-fast",
		family: "gpt-mini",
		reasoning: true,
		temperature: false,
		toolCall: true,
		modalities: {
			input: ["text", "image"],
			output: ["text"],
		},
		limit: {
			context: 400000,
			input: 272000,
			output: 128000,
		},
	},
	"nemotron-3-super-120b-a12b:free": {
		id: "nemotron-3-super-120b-a12b:free",
		family: "nemotron",
		reasoning: true,
		temperature: true,
		toolCall: true,
		modalities: {
			input: ["text"],
			output: ["text"],
		},
		limit: {
			context: 131072,
			input: 128000,
			output: 8192,
		},
	},
}
