const els = {
    timestamp: document.getElementById('timestamp'),
    timestampMs: document.getElementById('timestampMs'),

    subSelect: document.getElementById('subSelect'),
    subError: document.getElementById('subError'),

    dirReset: document.getElementById('dirReset'),
    dirInput: document.getElementById('dirInput'),
    dirBrowse: document.getElementById('dirBrowse'),
    dirError: document.getElementById('dirError'),

    fileReset: document.getElementById('fileReset'),
    fileContainer: document.getElementById('fileContainer'),
    fileInput: document.getElementById('fileInput'),
    fileSuffix: document.getElementById('fileSuffix'),
    fileError: document.getElementById('fileError'),
    fileWarning: document.getElementById('fileWarning'),

    delayReset: document.getElementById('delayReset'),
    delayInput: document.getElementById('delayInput'),
    delaySuffix: document.getElementById('delaySuffix'),

    cbFps: document.getElementById('cbFps'),
    fpsContainer: document.getElementById('fpsContainer'),
    fpsVideo: document.getElementById('fpsVideo'),
    fpsVideoValue: document.getElementById('fpsVideoValue'),
    fpsSource: document.getElementById('fpsSource'),
    fpsTarget: document.getElementById('fpsTarget'),
    fpsError: document.getElementById('fpsError'),

    cbLang: document.getElementById('cbLang'),
    langContainer: document.getElementById('langContainer'),
    langInfo: document.getElementById('langInfo'),
    langInfoLabel: document.getElementById('langInfoLabel'),
    langInfoValue: document.getElementById('langInfoValue'),
    langInput: document.getElementById('langInput'),
    langError: document.getElementById('langError'),

    cbActive: document.getElementById('cbActive'),
    cbDelayName: document.getElementById('cbDelayName'),
    cbOverwrite: document.getElementById('cbOverwrite'),

    statusContainer: document.getElementById('statusContainer'),
    statusIcon: document.getElementById('statusIcon'),
    statusText: document.getElementById('statusText'),
    saveBtn: document.getElementById('saveBtn'),

    historyContainer: document.getElementById('historyContainer')
};

const PluginEvent = {
    INIT: 'save-subtitles-init',
    DIR_CHANGE: 'save-subtitles-change-dir',
    DELAY_UPDATE: 'save-subtitles-update-delay',
    SUBS_UPDATE: 'save-subtitles-update-tracks',
    TIME_UPDATE: 'save-subtitles-update-time',
    PATH_STATUS: 'save-subtitles-path-status',
    SAVE_RESULT: 'save-subtitles-save-result',

    VISIBILITY: 'save-subtitles-visible',
    SAVE: 'save-subtitles-save',
    BROWSE: 'save-subtitles-browse-dir',
    SUB_CHANGE: 'save-subtitles-change-subtitle',
    CHECK_PATH: 'save-subtitles-check-path'
}

const SaveStatus = { OK: 0, ERROR_SUB: 1, ERROR_DIR: 2, ERROR_OTHER: 3, WARNING: 4 };
const StatusConfig = {
    [SaveStatus.OK]: { icon: '✓', cssClass: 'success' },
    [SaveStatus.WARNING]: { icon: '!', cssClass: 'warning' }
};

const timers = { pathDebounce: null, fileResetCooldown: null, dirResetCooldown: null, browseCooldown: null, langCooldown: null, saveCooldown: null }
const states = { dir: "", filename: "", lang: "", videoFps: 0, subDelay: 0, saveStatus: null }
const forms = {
    sub: { error: false, el: els.subError, borders: [els.subSelect] },
    dir: { error: false, el: els.dirError, borders: [els.dirInput] },
    file: { error: false, el: els.fileError, borders: [els.fileContainer] },
    fps: { error: false, el: els.fpsError, borders: [els.fpsTarget, els.fpsSource] },
    lang: { error: false, el: els.langError, borders: [els.langInput] }
};

// --- Utility ---
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function toggle(el, visible) { el.classList.toggle('hidden', !visible); }

function toggleError(form, visible, message = "", inactiveBorder) {
    form.borders.forEach(b => b.classList.toggle('has-error', visible));
    inactiveBorder?.classList.remove('has-error');

    if (message) form.el.textContent = message;
    toggle(form.el, visible);

    form.error = visible;
    els.saveBtn.disabled = Object.values(forms).some(form => form.error);
}

// --- Save Status ---
function showStatus(status, message) {
    const c = StatusConfig[status];
    els.statusContainer.className = `status-banner ${c?.cssClass ?? 'error'}`;
    els.statusIcon.textContent = c?.icon ?? '✕';
    els.statusText.textContent = message;

    show(els.statusContainer);
    states.saveStatus = status;
}

function hideStatus(status, force) {
    if (states.saveStatus == null) return;

    const isStrict = states.saveStatus === SaveStatus.ERROR_DIR || states.saveStatus === SaveStatus.ERROR_SUB;
    if (!isStrict || force || states.saveStatus === status) {
        states.saveStatus = null;
        hide(els.statusContainer);
    }
}

// --- Validation ---
function validateLang() {
    const invalid = els.cbLang.checked && !els.langInput.value?.trim();
    toggleError(forms.lang, invalid);
}

function validateFps() {
    if (!els.cbFps.checked)
        return toggleError(forms.fps, false);

    const src = els.fpsSource.value?.trim();
    const dst = els.fpsTarget.value?.trim();

    let error = "";
    if (!dst)
        error = 'Enter a target FPS';
    else if ((Number(dst) || 0) <= 0)
        error = 'Target FPS must be > 0';
    else if (src && (Number(src) || 0) <= 0)
        error = 'Source FPS must be > 0';
    else if (!src && states.videoFps <= 0)
        error = 'Enter a source FPS (video FPS unavailable)';

    toggleError(forms.fps, !!error, error, error.includes("arget") ? els.fpsSource : els.fpsTarget);
}

function validateCurrentTrack() {
    const selected = els.subSelect.selectedOptions[0];

    let error = "";
    if (!selected?.value)
        error = 'No subtitle tracks available';
    else if (selected.value === "0")
        error = 'Select a subtitle track';
    else if (selected.dataset.codec !== 'subrip')
        error = 'Only SRT subtitles are supported';
    else if (selected.dataset.external !== "true")
        error = 'Internal subtitles aren\'t supported';

    toggleError(forms.sub, !!error, error);
}

function validatePath(opts = {}) {
    clearTimeout(timers.pathDebounce);

    const dirPath = els.dirInput.value?.trim();
    const filenameEmpty = filenameIsEmpty();

    if (!dirPath || opts.dirChanged)
        toggleError(forms.dir, !dirPath, "Select a destination folder");
    else if (opts.dirMissing !== undefined)
        toggleError(forms.dir, opts.dirMissing, "Folder not found")

    toggleError(forms.file, filenameEmpty);
    if (filenameEmpty || opts.fileChanged || opts.dirChanged)
        hide(els.fileWarning);
    else if (opts.fileExists !== undefined)
        toggle(els.fileWarning, opts.fileExists);

    if (!dirPath || opts.checkResult) return;

    timers.pathDebounce = setTimeout(
        () => iina.postMessage(PluginEvent.CHECK_PATH, { dirPath: dirPath, filename: filenameEmpty ? "" : smartFilename() }),
        opts.debounce ? 500 : 0
    );
}

// --- Filename ---
function toggleFilenameSuffix() {
    toggle(els.fileSuffix, !els.fileInput.value?.trim().toLowerCase().endsWith('.srt'));
}

function filenameIsEmpty() {
    let filename = els.fileInput.value?.trim();
    return !filename || filename.toLowerCase() === '.srt';
}

function smartFilename(delayMs) {
    let filename = els.fileInput.value?.trim();
    if (!filename) return "";

    const lower = filename.toLowerCase();
    if (!lower.endsWith('.srt'))
        filename += lower.endsWith('.') ? 'srt' : '.srt';

    if (els.cbDelayName.checked) {
        delayMs ??= delayToMs(els.delayInput.value);
        filename = filename.replace(/\.?(\.srt)$/i, `.${delayMs}$1`)
    }

    const langCode = els.cbLang.checked ? els.langInput.value?.trim() : "";
    if (langCode)
        filename = filename.replace(/\.?(\.srt)$/i, `.${langCode}$1`)

    return filename;
}

// --- Delay Parsing & Formatting ---
function delayToMs(value) {
    if (!value) return 0;

    // Pure milliseconds (integer with optional minus)
    if (/^-?\d+$/.test(value))
        return parseInt(value, 10) || 0;

    const negative = value.startsWith('-');
    if (negative) value = value.substring(1);

    // Timestamp format with colons (e.g., "1:30.500" or ":::" or "-:::.")
    const multipliers = [1, 60, 3600];
    value = value.split(':').reverse()
        .reduce((acc, v, i) => acc + (parseFloat(v) || 0) * multipliers[i], 0);

    const ms = Math.round(value * 1000);
    return negative ? -ms : ms;
}

function msToDelay(totalMs) {
    if (totalMs === null) return "";

    const sign = totalMs < 0 ? "–" : "";

    totalMs = Math.abs(totalMs);
    if (totalMs < 1000) return "";

    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;

    let parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0) parts.push(`${s}s`);
    if (ms > 0 && parts.length !== 0) parts.push(`${ms}ms`);

    return sign + parts.join(" ");
}

function updateDelaySuffix() {
    const value = els.delayInput.value;
    if (!value || value.includes(':') || !/\d/.test(value)) {
        hide(els.delaySuffix);
        return;
    }

    els.delaySuffix.textContent = value.includes('.') ? 's' : 'ms';
    show(els.delaySuffix);
}

// --- Input Sanitization ---
function sanitizeInput(e, sanitizeFn) {
    const input = e.target;
    const { value: inputValue, selectionStart: pos } = input;

    const clean = sanitizeFn(inputValue);
    if (inputValue === clean) return;

    const cleanPos = sanitizeFn(inputValue.slice(0, pos)).length;
    input.value = clean;
    input.setSelectionRange(cleanPos, cleanPos);
}

function sanitizeDirInput(e) {
    sanitizeInput(e, inputValue => inputValue.replace(/\p{Cc}+/gu, '').replace(/\s/g, ' ')
        .replace(/[:\\]/g, '').replace(/\/+/g, '/'));
}

function sanitizeFileInput(e) {
    sanitizeInput(e, inputValue => inputValue.replace(/\p{Cc}+/gu, '').replace(/\s/g, ' ')
        .replace(/[/:\\]/g, ''));
}

function sanitizeDelayInput(e) {
    sanitizeInput(e, inputValue => {
        const negative = inputValue.trimStart().startsWith('-');
        const clean = inputValue.replace(/,/g, '.').replace(/[^0-9:.]/g, '');

        const parts = clean.split(':');
        const secIndex = Math.min(parts.length - 1, 2);

        const timeParts = parts.slice(0, secIndex).map(p => p.replace(/[^0-9]/g, ''));

        const secPart = parts.slice(secIndex).join('');
        const [sec, ...msParts] = secPart.replace(/[^0-9.]/g, '').split('.');

        const timestamp = [
            ...timeParts,
            msParts.length > 0 ? `${sec}.${msParts.join('').slice(0, 3)}` : sec
        ].join(':');

        return negative
            ? '-' + timestamp
            : timestamp;
    });
}

function sanitizeLangInput(e) {
    sanitizeInput(e, inputValue => inputValue.toLowerCase().replace(/[^a-z]/g, '').slice(0, 3));
}

function sanitizeFpsInput(e) {
    sanitizeInput(e, inputValue => {
        const clean = inputValue.replace(/,/g, '.').replace(/[^0-9.]/g, '');

        const [whole, ...fractional] = clean.split('.');
        return fractional.length > 0
            ? whole + '.' + fractional.join('').slice(0, 3)
            : clean;
    });
}

// --- Subtitle Track Logic ---
function trackOption(id, title, codec, external, selected) {
    const externalSrt = external && codec === 'subrip';
    const type = externalSrt ? "SRT" : (external ? "EXT" : "INT");
    const label = `[${type}] ${title}`;

    const opt = new Option(label, id, false, selected);
    opt.dataset.codec = codec;
    opt.dataset.external = external;

    if (!externalSrt) {
        opt.style.color = 'var(--text-secondary)';
    }

    return opt;
}

function updateTrackUI(tracks) {
    const fragment = document.createDocumentFragment();

    if (tracks.length === 0) {
        const emptyOpt = new Option("", "", false, true);
        emptyOpt.disabled = true;
        fragment.append(emptyOpt);
    } else {
        fragment.append(
            ...tracks.map(t => trackOption(t.id, t.title, t.codec, t.external, t.selected))
        );

        const noneSelected = !tracks.some(t => t.selected);
        fragment.append(
            new Option("None", "0", false, noneSelected)
        );
    }

    els.subSelect.replaceChildren(fragment);
    validateCurrentTrack();
}

function updateLang(lang, fallbackLang) {
    states.lang = lang || fallbackLang || "";
    if (!els.langInput.value || lang) {
        els.langInput.value = states.lang;
    }

    if (!states.lang) return hide(els.langInfo);

    els.langInfoLabel.textContent = lang ? "Detected:" : "Fallback:";
    els.langInfoValue.textContent = states.lang;
    show(els.langInfo);
}

// --- History ---
function addToHistory(rawInput, ms) {
    if (els.historyContainer.querySelector('.empty-state'))
        els.historyContainer.replaceChildren();

    const existingItem = els.historyContainer.querySelector(`[data-ms="${ms}"]`);
    if (existingItem)
        existingItem.remove();

    const div = document.createElement('div');
    div.className = 'history-item';
    div.dataset.rawInput = rawInput;
    div.dataset.ms = ms;
    div.innerHTML = `
        <span>${ms < 0 ? '–' : ''}${Math.abs(ms)}ms</span>
        <span class="history-time">${msToDelay(ms)}</span>
    `;

    els.historyContainer.prepend(div);
    while (els.historyContainer.childElementCount > 10)
        els.historyContainer.lastElementChild.remove();
}

// --- Save Logic ---
function save() {
    const fpsConvert = els.cbFps.checked;
    const fpsSource = fpsConvert ? parseFloat(els.fpsSource.value) || states.videoFps : 0;
    const fpsTarget = fpsConvert ? parseFloat(els.fpsTarget.value) || 0 : 0;

    const delayStr = els.delayInput.value;
    const delayMs = delayToMs(delayStr);
    addToHistory(delayStr, delayMs);

    iina.postMessage(PluginEvent.SAVE, {
        dir: els.dirInput.value?.trim(),
        filename: smartFilename(),
        delayMs: delayMs,
        setActive: els.cbActive.checked,
        overwrite: els.cbOverwrite.checked,
        fpsSource: fpsSource,
        fpsTarget: fpsTarget
    });
}

// --- IINA Communication ---
iina.onMessage(PluginEvent.INIT, data => {
    hideStatus(null, true);

    if (data.videoDir) {
        const currentDir = els.dirInput.value?.trim();
        if (!currentDir || currentDir === states.dir) els.dirInput.value = data.videoDir;
    }

    if (data.videoName) {
        const currentFilename = els.fileInput.value?.trim();
        if (!currentFilename || currentFilename === states.filename) els.fileInput.value = data.videoName;
    }

    if (data.videoFps > 0) {
        const currentFPS = Number(els.fpsSource.value?.trim());
        if (!currentFPS || currentFPS === states.videoFps) els.fpsSource.value = data.videoFps;
    }

    els.delayInput.value = data.delayMs !== 0 ? data.delayMs : "";

    states.dir = data.videoDir;
    states.filename = data.videoName;
    states.videoFps = data.videoFps;
    states.subDelay = data.delayMs || 0;

    toggle(els.delayReset, states.subDelay !== 0);

    els.fpsVideoValue.textContent = states.videoFps > 0 ? states.videoFps : "N/A";
    toggle(els.fpsVideo, states.videoFps > 0);

    updateLang(data.lang, data.fallbackLang);

    validateFps();
    updateDelaySuffix();
    updateTrackUI(data.tracks);
    validateLang();
    validatePath({ dirChanged: true, fileChanged: true });
});

iina.onMessage(PluginEvent.TIME_UPDATE, ({ time, paused }) => {
    if (!paused || !time) {
        els.timestamp.textContent = "-";
        els.timestampMs.textContent = "";
        return;
    }

    const [main, ms] = time.split(',');
    els.timestamp.textContent = main;
    els.timestampMs.textContent = ms ? `.${ms}` : "";
});

iina.onMessage(PluginEvent.DELAY_UPDATE, delayMs => {
    states.subDelay = delayMs || 0;
    els.delayInput.value = delayMs !== 0 ? delayMs : "";

    toggle(els.delayReset, states.subDelay !== 0);
    updateDelaySuffix();

    if (els.cbDelayName.checked)
        validatePath({ fileChanged: true });
});

iina.onMessage(PluginEvent.SUBS_UPDATE, ({ fallbackLang, lang, tracks }) => {
    updateLang(lang, fallbackLang);
    updateTrackUI(tracks);
    validateLang();
    validatePath({ fileChanged: true });
});

iina.onMessage(PluginEvent.DIR_CHANGE, dirPath => {
    els.dirInput.value = dirPath;
    hideStatus(SaveStatus.ERROR_DIR);
    validatePath({ dirChanged: true });
});

iina.onMessage(PluginEvent.PATH_STATUS, (status) => {
    validatePath({ checkResult: true, dirMissing: !status.dirExists, fileExists: status.fileExists });
});

iina.onMessage(PluginEvent.SAVE_RESULT, (result) => {
    showStatus(result.status, result.message);
    if (result.status === SaveStatus.OK || result.status === SaveStatus.ERROR_OTHER) validatePath();
});

// --- Path Event Listeners ---
els.dirInput.addEventListener('input', e => {
    sanitizeDirInput(e);
    hideStatus(SaveStatus.ERROR_DIR);
    validatePath({ debounce: true, dirChanged: true });
});

els.dirReset.addEventListener('click', e => {
    e.preventDefault();
    hideStatus(SaveStatus.ERROR_DIR);

    if (els.dirInput.value === states.dir || timers.dirResetCooldown) return;
    timers.dirResetCooldown = setTimeout(() => timers.dirResetCooldown = null, 1000);

    els.dirInput.value = states.dir;
    validatePath({ dirChanged: true });
});

els.dirBrowse.addEventListener('click', () => {
    if (timers.browseCooldown) return;
    timers.browseCooldown = setTimeout(() => timers.browseCooldown = null, 1000);

    iina.postMessage(PluginEvent.BROWSE);
});

els.fileInput.addEventListener('input', e => {
    sanitizeFileInput(e);
    hideStatus();
    toggleFilenameSuffix();
    validatePath({ debounce: true, fileChanged: true });
});

els.fileReset.addEventListener('click', e => {
    e.preventDefault();
    hideStatus();

    if (els.fileInput.value === states.filename || timers.fileResetCooldown) return;
    timers.fileResetCooldown = setTimeout(() => timers.fileResetCooldown = null, 1000);

    els.fileInput.value = states.filename;
    toggleFilenameSuffix();
    validatePath({ fileChanged: true });
});

// --- Lang Listeners ---
els.cbLang.addEventListener('change', e => {
    toggle(els.langContainer, e.target.checked);
    hideStatus();
    validateLang();
    validatePath({ fileChanged: true });
});

els.langInput.addEventListener('input', e => {
    sanitizeLangInput(e);
    hideStatus();
    validateLang();
    validatePath({ debounce: true, fileChanged: true });
});

els.langInfoValue.addEventListener('click', () => {
    hideStatus();

    if (els.langInput.value === `${states.lang}` || timers.langCooldown) return;
    timers.langCooldown = setTimeout(() => timers.langCooldown = null, 1000);

    els.langInput.value = states.lang;
    validateLang();
    validatePath({ fileChanged: true });
});

// --- Event Listeners ---
els.subSelect.addEventListener('change', e => {
    hideStatus(SaveStatus.ERROR_SUB);
    validateCurrentTrack();

    const newId = parseInt(e.target.value, 10);
    if (Number.isNaN(newId)) return;

    iina.postMessage(PluginEvent.SUB_CHANGE, newId);
});

els.delayInput.addEventListener('input', e => {
    sanitizeDelayInput(e);
    hideStatus();
    updateDelaySuffix();
    if (els.cbDelayName.checked)
        validatePath({ debounce: true, fileChanged: true });
});

els.delayReset.addEventListener('click', e => {
    e.preventDefault();
    hideStatus();

    if (els.delayInput.value === `${states.subDelay}`) return;

    els.delayInput.value = states.subDelay !== 0 ? states.subDelay : "";
    updateDelaySuffix();
    if (els.cbDelayName.checked)
        validatePath({ fileChanged: true });
});

els.cbDelayName.addEventListener('change', () => {
    hideStatus();
    validatePath({ fileChanged: true });
});

els.cbFps.addEventListener('change', e => {
    toggle(els.fpsContainer, e.target.checked);
    hideStatus();
    validateFps();
});
els.fpsVideoValue.addEventListener('click', () => {
    hideStatus();

    const videoFps = states.videoFps || 0;
    if (videoFps <= 0 || els.fpsSource.value === `${videoFps}`) return;

    els.fpsSource.value = videoFps;
    validateFps();
});
els.fpsSource.addEventListener('input', e => {
    sanitizeFpsInput(e);
    hideStatus();
    validateFps();
});
els.fpsTarget.addEventListener('input', e => {
    sanitizeFpsInput(e);
    hideStatus();
    validateFps();
});

els.cbActive.addEventListener('change', hideStatus);
els.cbOverwrite.addEventListener('change', hideStatus);

els.saveBtn.addEventListener('click', () => {
    if (timers.saveCooldown) return;
    timers.saveCooldown = setTimeout(() => timers.saveCooldown = null, 1000);

    hideStatus(null, true);
    save();
});

els.historyContainer.addEventListener('click', e => {
    const item = e.target.closest('.history-item');
    if (!item) return;

    els.delayInput.value = item.dataset.rawInput;
    hideStatus();
    updateDelaySuffix();
    if (els.cbDelayName.checked)
        validatePath({ fileChanged: true });
});

document.addEventListener('visibilitychange', () => {
    iina.postMessage(PluginEvent.VISIBILITY, !document.hidden);
});
