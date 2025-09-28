import { loadClients, saveClients, createClientId, upsertClient, deleteClient } from './state.js';
import { initializeSheetsSync } from './sheets.js';

const MAP_REGION = 'AU';
const TIME_ZONE = 'Australia/Melbourne';

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const labelFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TIME_ZONE,
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
});

function formatDateToKey(date) {
  return dateKeyFormatter.format(date);
}

let state = {
  clients: [],
  googleReady: false,
  autocomplete: null,
  draftPlace: null,
  geocoder: null,
  latestRoute: null,
  mapsApiKey: null,
  sheets: {
    config: {
      spreadsheetId: '',
      tabName: 'Clients',
      clientId: '',
    },
    sync: null,
    ready: false,
  },
};

let sheetsPushTimer = null;

const elements = {
  quickAdd: document.getElementById('quickAdd'),
  addSchedule: document.getElementById('add-schedule'),
  startRoute: document.getElementById('startRoute'),
  todayList: document.getElementById('today-list'),
  noPlan: document.getElementById('no-plan'),
  upcomingList: document.getElementById('upcoming-list'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modal-title'),
  closeModal: document.getElementById('close-modal'),
  cancelForm: document.getElementById('cancel-form'),
  form: document.getElementById('schedule-form'),
  nameInput: document.getElementById('client-name'),
  addressInput: document.getElementById('client-address'),
  dateInput: document.getElementById('client-date'),
  timeInput: document.getElementById('client-time'),
  contactInput: document.getElementById('client-contact'),
  idInput: document.getElementById('client-id'),
  toast: document.getElementById('toast'),
  loading: document.getElementById('loading'),
  routeSummary: document.getElementById('route-summary'),
};

const todayKey = () => formatDateToKey(new Date());

init();

async function init() {
  state.clients = sortClients(loadClients());
  render();
  bindEvents();
  await loadGoogleConfig();
  if (state.mapsApiKey) {
    await injectGoogleMaps(state.mapsApiKey);
  }
  await setupSheetsSync();
}
function bindEvents() {
  elements.quickAdd.addEventListener('click', () => openModal());
  elements.addSchedule.addEventListener('click', () => openModal());
  elements.closeModal.addEventListener('click', closeModal);
  elements.cancelForm.addEventListener('click', closeModal);
  elements.form.addEventListener('submit', handleFormSubmit);
  elements.addressInput.addEventListener('input', () => {
    state.draftPlace = null;
  });
  elements.startRoute.addEventListener('click', handleStartRoute);
  elements.routeSummary.addEventListener('click', handleRouteSummaryActions);
}

function render() {
  renderToday();
  renderUpcoming();
}

function renderToday() {
  const today = todayKey();
  const todayClients = state.clients.filter((item) => item.date === today);
  elements.todayList.innerHTML = '';
  if (!todayClients.length) {
    elements.noPlan.classList.remove('hidden');
    elements.routeSummary.classList.add('hidden');
    state.latestRoute = null;
    return;
  }
  elements.noPlan.classList.add('hidden');
  todayClients.forEach((client) => {
    const li = document.createElement('li');
    li.className = 'client-card';
    li.innerHTML = renderClientInner(client);
    bindClientActions(li, client);
    elements.todayList.appendChild(li);
  });
}
function renderUpcoming() {
  const today = todayKey();
  const futureClients = state.clients.filter((item) => item.date >= today);
  const grouped = groupByDate(futureClients);
  elements.upcomingList.innerHTML = '';

  Object.keys(grouped)
    .sort()
    .forEach((date) => {
      const list = grouped[date];
      const container = document.createElement('div');
      container.className = 'schedule-group';
      const header = document.createElement('h3');
      header.textContent = formatDateLabel(date, date === today);
      container.appendChild(header);

      const ul = document.createElement('ul');
      ul.className = 'schedule-items';
      list.forEach((client) => {
        const li = document.createElement('li');
        li.className = 'client-card';
        li.innerHTML = renderClientInner(client);
        bindClientActions(li, client);
        ul.appendChild(li);
      });

      container.appendChild(ul);
      elements.upcomingList.appendChild(container);
    });
}

function renderClientInner(client) {
  const time = client.time ? `时间：${client.time}` : '时间：全天';
  const contact = client.contact ? `<span>联系方式：${client.contact}</span>` : '';
  return `
    <div class="client-header">
      <span class="name">${client.name}</span>
      <div class="actions" role="group">
        <button class="link-button edit" type="button">编辑</button>
        <button class="link-button danger delete" type="button">删除</button>
      </div>
    </div>
    <div class="meta">${formatDateLabel(client.date, client.date === todayKey())}</div>
    <div class="meta">${client.address}</div>
    <div class="meta">${time}</div>
    ${contact ? `<div class="meta">${contact}</div>` : ''}
  `;
}
function bindClientActions(element, client) {
  element.querySelector('.edit').addEventListener('click', () => openModal(client));
  element.querySelector('.delete').addEventListener('click', () => requestDelete(client));
}

function requestDelete(client) {
  const first = window.confirm(`确定要删除 “${client.name}” 的行程吗？`);
  if (!first) return;
  const second = window.confirm('再次确认：删除后无法恢复，是否继续？');
  if (!second) return;
  state.clients = deleteClient(state.clients, client.id);
  saveClients(state.clients);
  scheduleSheetsPush();
  render();
  showToast('已删除该客户行程');
}

function openModal(client) {
  const isEdit = Boolean(client);
  state.draftPlace = client
    ? {
        placeId: client.placeId || null,
        location: client.location || null,
        description: client.address,
      }
    : null;
  elements.form.reset();
  elements.idInput.value = client ? client.id : '';
  elements.modalTitle.textContent = isEdit ? '编辑日程' : '添加日程';
  if (client) {
    elements.nameInput.value = client.name || '';
    elements.addressInput.value = client.address || '';
    elements.dateInput.value = client.date || '';
    elements.timeInput.value = client.time || '';
    elements.contactInput.value = client.contact || '';
  } else {
    const today = todayKey();
    elements.dateInput.value = today;
  }

  toggleModal(true);
  setTimeout(() => {
    elements.nameInput.focus();
    elements.nameInput.select();
  }, 50);
}

function closeModal() {
  toggleModal(false);
  elements.form.reset();
  state.draftPlace = null;
}

function toggleModal(isOpen) {
  elements.modal.classList.toggle('hidden', !isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 2200);
}
function handleFormSubmit(event) {
  event.preventDefault();
  const formData = new FormData(elements.form);
  const name = formData.get('name').trim();
  const address = formData.get('address').trim();
  const date = formData.get('date');
  const time = formData.get('time');
  const contact = formData.get('contact').trim();
  const id = elements.idInput.value || createClientId();

  if (!name || !address || !date) {
    showToast('请填写必填信息');
    return;
  }

  const confirmed = window.confirm('确认好哪个区了吗？');
  if (!confirmed) return;

  const existing = state.clients.find((client) => client.id === id);
  const payload = {
    id,
    name,
    address,
    date,
    time: time || '',
    contact: contact || '',
    placeId: state.draftPlace?.placeId || existing?.placeId || null,
    location: state.draftPlace?.location || existing?.location || null,
  };

  state.clients = sortClients(upsertClient(state.clients, payload));
  saveClients(state.clients);
  scheduleSheetsPush();
  render();
  closeModal();
  showToast(existing ? '已更新行程' : '已添加行程');
}
function sortClients(clients) {
  const getTimeValue = (time) => {
    if (!time) return Number.MAX_SAFE_INTEGER;
    const [h, m] = time.split(':');
    return parseInt(h, 10) * 60 + parseInt(m || '0', 10);
  };
  return [...clients].sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    return getTimeValue(a.time) - getTimeValue(b.time);
  });
}

function groupByDate(clients) {
  return clients.reduce((acc, item) => {
    if (!acc[item.date]) acc[item.date] = [];
    acc[item.date].push(item);
    return acc;
  }, {});
}

function formatDateLabel(dateString, isToday) {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const label = labelFormatter.format(date);
  return isToday ? `今天 · ${label}` : label;
}
async function setupSheetsSync() {
  const { spreadsheetId, clientId } = state.sheets.config;
  if (!spreadsheetId || !clientId) {
    return;
  }
  try {
    const sync = await initializeSheetsSync({
      onAuthPrompt: () => showToast('请登录 Google 账户以同步行程'),
    });
    if (!sync) {
      return;
    }
    state.sheets.sync = sync;
    state.sheets.ready = true;
    try {
      const remoteClients = await sync.pull();
      if (Array.isArray(remoteClients) && remoteClients.length) {
        state.clients = sortClients(remoteClients);
        saveClients(state.clients);
        render();
        showToast('已从 Google Sheets 加载行程');
      }
    } catch (error) {
      console.warn('读取 Google Sheets 数据失败', error);
    }
  } catch (error) {
    console.error('Google Sheets 同步初始化失败', error);
  }
}

function scheduleSheetsPush() {
  if (!state.sheets.ready || !state.sheets.sync?.push) {
    return;
  }
  if (sheetsPushTimer) {
    clearTimeout(sheetsPushTimer);
  }
  sheetsPushTimer = setTimeout(async () => {
    try {
      await state.sheets.sync.push(state.clients);
    } catch (error) {
      console.error('同步 Google Sheets 失败', error);
      const canceled = error?.type === 'popup_closed_by_user' || error?.error === 'popup_closed_by_user';
      showToast(canceled ? '未完成 Google 授权，已保留本地数据' : '同步 Google Sheets 失败，请稍后重试');
    }
  }, 1200);
}

async function loadGoogleConfig() {
  try {
    const module = await import('../config.js');
    if (module?.GOOGLE_MAPS_API_KEY) {
      state.mapsApiKey = module.GOOGLE_MAPS_API_KEY;
    }
    if (module?.GOOGLE_SHEETS_SPREADSHEET_ID) {
      state.sheets.config.spreadsheetId = module.GOOGLE_SHEETS_SPREADSHEET_ID;
    }
    if (module?.GOOGLE_SHEETS_TAB_NAME) {
      state.sheets.config.tabName = module.GOOGLE_SHEETS_TAB_NAME;
    }
    if (module?.GOOGLE_OAUTH_CLIENT_ID) {
      state.sheets.config.clientId = module.GOOGLE_OAUTH_CLIENT_ID;
    }
  } catch (error) {
    console.warn('未找到 config.js，将以离线模式运行。');
  }
}

async function injectGoogleMaps(apiKey) {
  if (window.google?.maps) {
    onGoogleReady();
    return;
  }
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&language=zh-CN&region=${MAP_REGION}`;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      onGoogleReady();
      resolve();
    });
    script.addEventListener('error', (error) => {
      console.error('Google Maps 脚本加载失败', error);
      reject(error);
    });
    document.head.appendChild(script);
  });
}

function onGoogleReady() {
  state.googleReady = true;
  state.geocoder = new google.maps.Geocoder();
  setupAutocomplete();
  console.info('Google Maps 已准备就绪');
}

function setupAutocomplete() {
  if (!state.googleReady || !google.maps.places?.Autocomplete) return;
  if (state.autocomplete) {
    google.maps.event.clearInstanceListeners(state.autocomplete);
  }
  state.autocomplete = new google.maps.places.Autocomplete(elements.addressInput, {
    fields: ['formatted_address', 'geometry', 'name', 'place_id'],
    componentRestrictions: { country: [MAP_REGION.toLowerCase()] },
  });

  state.autocomplete.addListener('place_changed', () => {
    const place = state.autocomplete.getPlace();
    if (!place) return;
    if (!place.geometry) {
      showToast('未找到该地址的位置信息，请换一个关键词');
      return;
    }
    const location = place.geometry.location;
    state.draftPlace = {
      placeId: place.place_id,
      location: { lat: location.lat(), lng: location.lng() },
      description: place.formatted_address || place.name,
    };
    if (place.formatted_address) {
      elements.addressInput.value = place.formatted_address;
    }
  });
}
async function handleStartRoute() {
  const today = todayKey();
  const todayClients = state.clients.filter((client) => client.date === today);
  if (!todayClients.length) {
    showToast('今日暂无客户行程');
    return;
  }
  if (!state.googleReady) {
    showToast('Google 地图服务未就绪，请先配置 API 密钥');
    return;
  }

  setLoading(true);
  try {
    const withLocations = await ensureClientLocations(todayClients);
    const origin = await getCurrentPosition();
    const orderedClients = computeGreedyRoute(withLocations, origin);
    const directions = await requestDirections(origin, orderedClients);
    const summary = summarizeRoute(directions, orderedClients);
    state.latestRoute = {
      origin,
      orderedClients,
      summary,
    };
    renderRouteSummary(summary, orderedClients);
  } catch (error) {
    console.error(error);
    showToast(typeof error === 'string' ? error : '规划路线失败，请稍后再试');
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  elements.loading.classList.toggle('hidden', !isLoading);
}

async function ensureClientLocations(clients) {
  if (!state.googleReady) return clients;
  const enriched = [];
  for (const client of clients) {
    if (client.location?.lat && client.location?.lng) {
      enriched.push(client);
      continue;
    }
    const location = await geocodeClient(client);
    enriched.push({ ...client, location });
    updateClientLocation(client.id, location, client.placeId || null);
  }
  return enriched;
}

function updateClientLocation(id, location, placeId) {
  state.clients = state.clients.map((client) => {
    if (client.id !== id) return client;
    return { ...client, location, placeId: placeId || client.placeId };
  });
  saveClients(state.clients);
  scheduleSheetsPush();
}

function geocodeClient(client) {
  return new Promise((resolve, reject) => {
    const request = client.placeId
      ? { placeId: client.placeId }
      : { address: client.address, region: MAP_REGION };
    state.geocoder.geocode(request, (results, status) => {
      if (status === 'OK' && results?.[0]?.geometry?.location) {
        const location = results[0].geometry.location;
        resolve({ lat: location.lat(), lng: location.lng() });
      } else {
        reject('无法解析地址，请检查输入内容');
      }
    });
  });
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject('无法获取当前位置，请在手机浏览器中允许定位权限');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => reject('无法获取当前位置，请检查定位权限'),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}
function computeGreedyRoute(clients, origin) {
  if (!clients.length) return [];
  const remaining = clients.map((client) => ({ ...client }));
  const ordered = [];
  let current = new google.maps.LatLng(origin.lat, origin.lng);

  while (remaining.length) {
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((client, index) => {
      if (!client.location) return;
      const target = new google.maps.LatLng(client.location.lat, client.location.lng);
      const distance = google.maps.geometry.spherical.computeDistanceBetween(current, target);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    const next = remaining.splice(nearestIndex, 1)[0];
    ordered.push(next);
    if (next.location) {
      current = new google.maps.LatLng(next.location.lat, next.location.lng);
    }
  }
  return ordered;
}

function requestDirections(origin, orderedClients) {
  return new Promise((resolve, reject) => {
    if (!orderedClients.length) {
      reject('今日暂无可用路线');
      return;
    }
    const service = new google.maps.DirectionsService();
    const destination = orderedClients[orderedClients.length - 1];
    const waypoints = orderedClients.slice(0, -1).map((client) => ({
      location: client.location
        ? new google.maps.LatLng(client.location.lat, client.location.lng)
        : client.address,
      stopover: true,
    }));

    service.route(
      {
        origin: new google.maps.LatLng(origin.lat, origin.lng),
        destination: destination.location
          ? new google.maps.LatLng(destination.location.lat, destination.location.lng)
          : destination.address,
        waypoints,
        travelMode: google.maps.TravelMode.DRIVING,
        avoidTolls: true,
        optimizeWaypoints: false,
      },
      (result, status) => {
        if (status === 'OK' && result?.routes?.length) {
          resolve(result.routes[0]);
        } else {
          reject('无法从 Google 获取路线，请稍后重试');
        }
      }
    );
  });
}
function summarizeRoute(route, orderedClients) {
  const legs = route.legs || [];
  const totalMeters = legs.reduce((sum, leg) => sum + (leg.distance?.value || 0), 0);
  const totalSeconds = legs.reduce((sum, leg) => sum + (leg.duration?.value || 0), 0);
  const totalKilometers = (totalMeters / 1000).toFixed(1);
  const durationText = formatDuration(totalSeconds);
  const googleUrl = buildGoogleMapsUrl(orderedClients, route);
  return {
    distanceKm: totalKilometers,
    durationText,
    googleUrl,
  };
}

function formatDuration(seconds) {
  if (!seconds) return '未知时长';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours && minutes) {
    return `${hours} 小时 ${minutes} 分钟`;
  }
  if (hours) {
    return `${hours} 小时`;
  }
  return `${minutes} 分钟`;
}

function buildGoogleMapsUrl(clients, route) {
  if (!state.latestRoute?.origin && route?.legs?.[0]?.start_location) {
    state.latestRoute = state.latestRoute || {};
    state.latestRoute.origin = {
      lat: route.legs[0].start_location.lat(),
      lng: route.legs[0].start_location.lng(),
    };
  }
  const origin = state.latestRoute?.origin;
  const originParam = origin
    ? `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`
    : 'My+Location';
  const dest = clients[clients.length - 1];
  const destParam = dest.location
    ? `${dest.location.lat.toFixed(6)},${dest.location.lng.toFixed(6)}`
    : encodeURIComponent(dest.address);
  const waypointParams = clients
    .slice(0, -1)
    .map((client) =>
      client.location
        ? `${client.location.lat.toFixed(6)},${client.location.lng.toFixed(6)}`
        : encodeURIComponent(client.address)
    )
    .join('%7C');
  const waypointSegment = waypointParams ? `&waypoints=${waypointParams}` : '';
  return `https://www.google.com/maps/dir/?api=1&origin=${originParam}&destination=${destParam}&travelmode=driving&dir_action=navigate&avoid=tolls${waypointSegment}`;
}

function renderRouteSummary(summary, orderedClients) {
  if (!summary || !orderedClients?.length) {
    elements.routeSummary.classList.add('hidden');
    return;
  }
  const listItems = orderedClients
    .map((client, index) => `<li>${index + 1}. ${client.name} ｜ ${client.address}</li>`)
    .join('');
  elements.routeSummary.innerHTML = `
    <p>路线已生成：约 ${summary.durationText} · ${summary.distanceKm} 公里（已避开收费路段）</p>
    <ol>${listItems}</ol>
    <div class="summary-actions">
      <button type="button" class="primary-button" data-action="open-maps">打开 Google 地图</button>
      <button type="button" class="secondary-button" data-action="copy">复制地址顺序</button>
    </div>
  `;
  elements.routeSummary.classList.remove('hidden');
}

function handleRouteSummaryActions(event) {
  const action = event.target?.dataset?.action;
  if (!action || !state.latestRoute) return;
  if (action === 'open-maps') {
    window.open(state.latestRoute.summary.googleUrl, '_blank');
  }
  if (action === 'copy') {
    const text = state.latestRoute.orderedClients
      .map((client, index) => `${index + 1}. ${client.name} - ${client.address}`)
      .join('\n');
    navigator.clipboard
      .writeText(text)
      .then(() => showToast('已复制今日路线'))
      .catch(() => showToast('复制失败，请检查浏览器权限'));
  }
}
