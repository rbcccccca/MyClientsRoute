import { GOOGLE_MAPS_API_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SHEETS_TAB_NAME } from '../config.js';

const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const HEADER = ['id', 'name', 'address', 'date', 'time', 'contact', 'placeId', 'lat', 'lng'];

const loadedScripts = new Map();
let gapiInitializedPromise = null;
let tokenClient = null;
let tokenRequestPromise = null;
let accessToken = null;

function ensureConfig() {
  return (
    typeof GOOGLE_SHEETS_SPREADSHEET_ID === 'string' &&
    GOOGLE_SHEETS_SPREADSHEET_ID &&
    typeof GOOGLE_OAUTH_CLIENT_ID === 'string' &&
    GOOGLE_OAUTH_CLIENT_ID
  );
}

function loadScript(src) {
  if (loadedScripts.has(src)) {
    return loadedScripts.get(src);
  }
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
  loadedScripts.set(src, promise);
  return promise;
}

async function ensureGapiClient() {
  if (window.gapi?.client) {
    return;
  }
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error('Missing Google API key for Sheets initialization');
  }
  if (!gapiInitializedPromise) {
    gapiInitializedPromise = loadScript('https://apis.google.com/js/api.js')
      .then(
        () =>
          new Promise((resolve, reject) => {
            window.gapi.load('client', async () => {
              try {
                await window.gapi.client.init({
                  apiKey: GOOGLE_MAPS_API_KEY,
                  discoveryDocs: [DISCOVERY_DOC],
                });
                resolve();
              } catch (error) {
                reject(error);
              }
            });
          })
      )
      .catch((error) => {
        gapiInitializedPromise = null;
        throw error;
      });
  }
  await gapiInitializedPromise;
}

async function ensureTokenClient() {
  if (tokenClient) {
    return tokenClient;
  }
  if (!GOOGLE_OAUTH_CLIENT_ID) {
    throw new Error('Missing Google OAuth client ID');
  }
  await loadScript('https://accounts.google.com/gsi/client');
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    scope: SCOPES,
    callback: () => {},
  });
  return tokenClient;
}

async function requestAccessToken(forcePrompt = false) {
  await ensureGapiClient();
  await ensureTokenClient();

  if (accessToken && !forcePrompt) {
    return accessToken;
  }
  if (tokenRequestPromise) {
    return tokenRequestPromise;
  }

  tokenRequestPromise = new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      tokenRequestPromise = null;
      if (response.error) {
        reject(response);
        return;
      }
      accessToken = response.access_token;
      window.gapi.client.setToken({ access_token: accessToken });
      resolve(accessToken);
    };
    try {
      tokenClient.requestAccessToken({ prompt: forcePrompt || !accessToken ? 'consent' : '' });
    } catch (error) {
      tokenRequestPromise = null;
      reject(error);
    }
  });

  return tokenRequestPromise;
}

function rowsToClients(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .map((row) => {
      const [id, name, address, date, time, contact, placeId, lat, lng] = row;
      if (!id || !name || !address || !date) {
        return null;
      }
      const latNumber = Number(lat);
      const lngNumber = Number(lng);
      const hasLocation = Number.isFinite(latNumber) && Number.isFinite(lngNumber);
      return {
        id,
        name,
        address,
        date,
        time: time || '',
        contact: contact || '',
        placeId: placeId || null,
        location: hasLocation ? { lat: latNumber, lng: lngNumber } : null,
      };
    })
    .filter(Boolean);
}

function clientsToRows(clients) {
  if (!Array.isArray(clients)) {
    return [];
  }
  return clients.map((client) => [
    client.id,
    client.name,
    client.address,
    client.date,
    client.time || '',
    client.contact || '',
    client.placeId || '',
    client.location?.lat ?? '',
    client.location?.lng ?? '',
  ]);
}

export async function initializeSheetsSync({ onAuthPrompt } = {}) {
  if (!ensureConfig()) {
    return null;
  }
  await ensureGapiClient();
  await ensureTokenClient();

  const tabName = GOOGLE_SHEETS_TAB_NAME || 'Clients';

  async function ensureAuthorized() {
    try {
      await requestAccessToken(false);
    } catch (error) {
      if (typeof onAuthPrompt === 'function') {
        onAuthPrompt(error);
      }
      await requestAccessToken(true);
    }
  }

  return {
    async pull() {
      await ensureAuthorized();
      const response = await window.gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
        range: `${tabName}!A2:I`,
      });
      return rowsToClients(response.result.values || []);
    },
    async push(clients) {
      await ensureAuthorized();
      const rows = clientsToRows(clients);
      await window.gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
        range: `${tabName}!A1:I1`,
        valueInputOption: 'RAW',
        resource: {
          values: [HEADER],
        },
      });
      await window.gapi.client.sheets.spreadsheets.values.clear({
        spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
        range: `${tabName}!A2:I`,
      });
      if (rows.length) {
        await window.gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
          range: `${tabName}!A2`,
          valueInputOption: 'RAW',
          resource: {
            values: rows,
          },
        });
      }
    },
  };
}
