const STORAGE_KEY = 'customer-route-planner-v1';

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { clients: [] };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.clients)) {
      return { clients: [] };
    }
    return {
      clients: parsed.clients.map((item) => ({
        ...item,
        location: item.location ?? null,
      })),
    };
  } catch (error) {
    console.warn('无法读取本地数据，将重置。', error);
    return { clients: [] };
  }
}

export function loadClients() {
  return readStorage().clients;
}

export function saveClients(clients) {
  const payload = { clients };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function createClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function upsertClient(clients, client) {
  const index = clients.findIndex((item) => item.id === client.id);
  if (index === -1) {
    return [...clients, client];
  }
  const next = [...clients];
  next[index] = client;
  return next;
}

export function deleteClient(clients, id) {
  return clients.filter((item) => item.id !== id);
}
