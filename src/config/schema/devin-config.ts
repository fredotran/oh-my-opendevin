import { z } from "zod"

export const DevinConfigSchema = z.object({
  watcher_enabled: z.boolean().optional(),
  watcher_poll_interval_ms: z.number().int().min(1000).optional(),
  watcher_os_notifications: z.boolean().optional(),
  watcher_system_reminders: z.boolean().optional(),
})

export type DevinConfig = z.infer<typeof DevinConfigSchema>
