import 'server-only';
import { api, PUBLIC_API_URL } from './api';

/** Catalog lists the submission form offers. */
export async function formCatalog() {
  const index = await api.index();
  return {
    platforms: index.platforms.map((p) => ({ id: p.id, name: p.name })),
    emulators: index.emulators.map((e) => ({ id: e.id, name: e.name, platforms: e.platforms })),
    devices: index.devices.map((d) => ({ id: d.id, name: d.name, displays: d.displays })),
    apiUrl: PUBLIC_API_URL,
  };
}
