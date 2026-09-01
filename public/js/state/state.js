/**
 * Global application and chat state.
 */
import { readStoredBoolean } from '../utils/storage.js'

export const runtime = {
  audioUnlocked: false,
  notificationsEnabled: (() => { try { return localStorage.getItem('dsh-mp-notify') === 'true' } catch { return false } })(),
  ignoringPop: false,
  routeGen: 0,
  chatQuery: 0,
  rpcN: 0,
  mux: null,
  host: null,
  pendingPoll: null,
  liveQuery: 0,
  listPollTimer: null,
  lastMsgScrollKey: null,
  svgUid: 0,
  prependAdjust: null,
  sessionLive: new Map(),
  chatScroll: { top: 0, stick: true, gen: 0, restoring: false },
  listScroll: { top: 0 },
  todoScroll: { top: 0 },
  composerNode: null,
  imeComposing: false,
  composerRenderQueued: false,
  todoToggleLock: 0,
  previewByPath: new Map(),
  uploadWaiters: new Map(),
  fileInput: null,
  attachProgressTimer: null,
  lightboxNode: null,
  lightboxEsc: null,
  lightboxCleanup: null,
  deferredInstallPrompt: null,
  sessionsQuery: 0,
}

export const state = {
  view: 'boot', // boot | pair | error | workspaces | sessions | chat | dir
  listMode: (() => { try { return localStorage.getItem('dsh-mp-list-mode') || 'flat' } catch { return 'flat' } })(),
  sortMode: (() => { try { return localStorage.getItem('dsh-mp-sort-mode') || 'recent' } catch { return 'recent' } })(),
  pinnedQuota: (() => { try { return localStorage.getItem('dsh-mp-pinned-quota') || 'auto' } catch { return 'auto' } })(),
  error: '',
  workspaces: [],
  wsQuery: '',
  sessions: [],
  presets: [],
  presetId: '',
  workspace: null,
  session: null,
  loading: true,
  loadingMore: false,
  creating: false,
  createError: '',
  cursor: undefined,
  hasMoreSessions: false,
  draft: '',
  attachments: [],
  sending: false,
  running: false,
  dir: null,
  home: '',
  dirError: '',
  todayAvailable: false,
  sheet: null,
  sheetReturn: null,
}

export const chat = {
  folder: null,
  messages: [],
  hasOlder: false,
  loading: true,
  tailLoading: true,
  liveBuffer: [],
  overflow: false,
  showToolCalls: readStoredBoolean('dsh.mobile.showToolCalls', true),
  showSystemMessages: readStoredBoolean('dsh.mobile.showSystemMessages', false),
  currentModel: undefined,
  modelSheet: { status: 'loading' },
  modelBusy: false,
  modelError: undefined,
  todos: null,
  todoCollapsed: readStoredBoolean('dsh.mobile.todoCollapsed', true),
  slashCommands: [],
  slashSkills: [],
  approvals: [],
  questions: [],
  outbox: [],
}

export const QUOTA_DEBOUNCE_MS = 15 * 1000
export const quota = {
  status: 'idle',
  deepseek: null,
  grok: null,
  lastFetchAt: 0,
  inFlight: null,
}

export const LOCATION_KEY = 'dsh.mobile.location'
