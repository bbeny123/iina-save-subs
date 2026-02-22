const { core, mpv, utils, file, menu, input, preferences, sidebar, event, console } = iina;

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

const langCache = new Map();
let fallbackLang;

let sidebarVisible = false;
let pauseHook = null;
let fileHook = null;
let delayHook = null;
let subHook = null;
let timeHook = null;
let timeUnhookTimeout = null;

const pad = (n, w = 2) => n.toString().padStart(w, '0');
const toMs = (hh, mm, ss, ms) => hh * 3600000 + mm * 60000 + ss * 1000 + (+ms);

function formatTimestamp(totalMs) {
    totalMs = Math.max(0, Math.round(totalMs));

    const hh = Math.floor(totalMs / 3600000);
    const mm = Math.floor((totalMs % 3600000) / 60000);
    const ss = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;

    return `${pad(hh)}:${pad(mm)}:${pad(ss)},${pad(ms, 3)}`;
}

function shiftSRT(subsPath, delayMs, fpsSource, fpsTarget) {
    const fpsRatio = fpsSource > 0 && fpsTarget > 0 ? (fpsSource / fpsTarget) : 1;
    const content = file.read(subsPath);
    const blocks = content.trim().split(/\s*\n\s*\n+/);

    const shifted = [];
    let subIndex = 1;
    for (const block of blocks) {
        const lines = block.trim().split(/\r?\n/);

        const timeLineIdx = lines.findIndex(l => l.includes('-->'));
        if (timeLineIdx === -1) continue;

        const match = lines[timeLineIdx].trim().match(/^(\d{1,2}):(\d{1,2}):(\d{1,2}),(\d{1,3})\s*-->\s*(\d{1,2}):(\d{1,2}):(\d{1,2}),(\d{1,3})$/);
        if (!match) continue;

        const endMs = delayMs + (fpsRatio * toMs(match[5], match[6], match[7], match[8]));
        if (endMs < 1) continue;

        const textLines = lines.slice(timeLineIdx + 1)
            .map(line => line.trimEnd())
            .filter(Boolean);
        if (textLines.length === 0) continue;

        const startMs = delayMs + (fpsRatio * toMs(match[1], match[2], match[3], match[4]));

        shifted.push(
            `${subIndex++}\r\n` +
            `${formatTimestamp(startMs)} --> ${formatTimestamp(endMs)}\r\n` +
            `${textLines.join('\r\n')}`
        );
    }

    return shifted.length > 0
        ? shifted.join('\r\n\r\n') + '\r\n'
        : null;
}

function trackLangCode() {
    const currentSub = core.subtitle?.currentTrack;
    if (!currentSub) return "";

    let key = !currentSub.lang && currentSub.isExternal
        ? activeSubPath()?.toLowerCase().match(/\.([a-z]{2,3})\.srt$/)?.[1]
        : currentSub.lang?.toLowerCase();

    if (!key) return "";

    if (langCache.has(key))
        return langCache.get(key);

    let langCode = "";
    try {
        langCode = new Intl.Locale(key).maximize()?.language;
    } catch (e) {
    }

    langCache.set(key, langCode);
    return langCode;
}

function registerMenuItem() {
    const keybind = preferences.get("keybind");
    const options = {};
    let hasConflict = false;

    if (keybind) {
        const kc = input.normalizeKeyCode(keybind);
        hasConflict = !!input.getAllKeyBindings()[kc];
        if (!hasConflict) options.keyBinding = keybind;
    }

    preferences.set("bindConflict", hasConflict);
    preferences.sync();

    menu.addItem(
        menu.item("Subtitles...", () => sidebarVisible ? sidebar.hide() : sidebar.show(), options)
    );
}

function activeSubPath() {
    return mpv.getString("current-tracks/sub/external-filename")?.trim();
}

function subTracks() {
    return core.subtitle.tracks.map(track => ({
        id: track.id,
        title: track.formattedTitle,
        codec: track.codec,
        external: track.isExternal,
        selected: track.isSelected
    }));
}

function videoInfo() {
    const videoUrl = core.status.url;

    let videoDir = "";
    let videoName = "";
    if (videoUrl?.startsWith('file://')) {
        const path = decodeURIComponent(videoUrl.slice(7));
        const lastSlash = path.lastIndexOf('/');
        const filename = path.slice(lastSlash + 1);

        videoDir = path.slice(0, lastSlash);
        videoName = filename.substring(0, filename.lastIndexOf('.')) || filename;
    }

    let videoFps = Number(mpv.getString("current-tracks/video/demux-fps")) || 0;
    if (videoFps <= 0) videoFps = Number(mpv.getString("container-fps")) || 0;
    videoFps = Math.round((videoFps || 0) * 1000) / 1000;

    const delayMs = Math.round(core.subtitle.delay * 1000);

    return { videoDir, videoName, videoFps, delayMs, fallbackLang, lang: trackLangCode(), tracks: subTracks() };
}

function filePath(dirPath, filename) {
    return dirPath.endsWith('/')
        ? `${dirPath}${filename}`
        : `${dirPath}/${filename}`;
}

function saveSubs(opts) {
    if (!opts.dir || !file.exists(opts.dir))
        return saveResult(SaveStatus.ERROR_DIR, "Destination folder not found");

    const subPath = activeSubPath();
    if (!subPath || !file.exists(subPath))
        return saveResult(SaveStatus.ERROR_SUB, "Subtitles are empty; nothing to save");

    const shiftedContent = shiftSRT(subPath, opts.delayMs, opts.fpsSource, opts.fpsTarget);
    if (!shiftedContent)
        return saveResult(SaveStatus.WARNING, "Processed subtitles were empty; file not saved");

    const outPath = filePath(opts.dir, opts.filename);
    const outExists = file.exists(outPath);
    if (outExists && !opts.overwrite && !utils.ask(`"${opts.filename}" already exists.\n\nThe existing file will be moved to the Trash.`))
        return saveResult(SaveStatus.WARNING, "Save cancelled");

    try {
        if (outExists) file.trash(outPath);
        file.write(outPath, shiftedContent);
    } catch (e) {
        return saveResult(SaveStatus.ERROR_OTHER, `Save failed: ${e.message}`);
    }

    const prevSubId = core.subtitle.id;
    core.subtitle.loadTrack(outPath);
    if (!opts.setActive && subPath !== activeSubPath())
        core.subtitle.id = prevSubId;

    saveResult(SaveStatus.OK, "Subtitles saved");
}

function saveResult(status, message) {
    sidebar.postMessage(PluginEvent.SAVE_RESULT, { status, message });
}

function updateTime() {
    const timeSec = Number(mpv.getString("time-pos/full")) || 0;
    sidebar.postMessage(PluginEvent.TIME_UPDATE, {
        time: formatTimestamp(Math.round(timeSec * 1000)),
        paused: core.status.paused,
    });
}

function updateVideoInfo() {
    sidebar.postMessage(PluginEvent.INIT, videoInfo());
}

function delayChanged(delay) {
    const delayMs = Math.round((Number(delay) || 0) * 1000);
    sidebar.postMessage(PluginEvent.DELAY_UPDATE, delayMs);
}

function subChanged() {
    sidebar.postMessage(PluginEvent.SUBS_UPDATE, { fallbackLang, lang: trackLangCode(), tracks: subTracks() });
}

function pauseChanged(paused) {
    updateTime();

    clearTimeout(timeUnhookTimeout);

    if (paused) {
        timeHook ??= event.on("mpv.time-pos.changed", updateTime);
    } else if (timeHook) {
        timeUnhookTimeout = setTimeout(() => {
            event.off("mpv.time-pos.changed", timeHook);
            timeHook = null;
        }, 100);
    }
}

function stopUpdating() {
    if (pauseHook) { event.off("mpv.pause.changed", pauseHook); pauseHook = null; }
    if (delayHook) { event.off("mpv.sub-delay.changed", delayHook); delayHook = null; }
    if (subHook) { event.off("mpv.sid.changed", subHook); subHook = null; }
    if (fileHook) { event.off("iina.file-loaded", fileHook); fileHook = null; }

    clearTimeout(timeUnhookTimeout);
    if (timeHook) { event.off("mpv.time-pos.changed", timeHook); timeHook = null; }
}

function startUpdating() {
    pauseChanged(core.status.paused)

    pauseHook ??= event.on("mpv.pause.changed", pauseChanged);
    delayHook ??= event.on("mpv.sub-delay.changed", delayChanged);
    subHook ??= event.on("mpv.sid.changed", subChanged);
    fileHook ??= event.on("iina.file-loaded", updateVideoInfo);
}

event.on("iina.window-loaded", () => {
    fallbackLang = preferences.get("fallbackLang")?.toLowerCase().match(/[a-z]{1,3}/)?.[0] || "";

    sidebar.loadFile("src/sidebar.html");

    sidebar.onMessage(PluginEvent.VISIBILITY, visible => {
        sidebarVisible = visible;
        if (visible) {
            updateVideoInfo();
            startUpdating();
        } else {
            stopUpdating();
        }
    });

    sidebar.onMessage(PluginEvent.SUB_CHANGE, (id) => {
        core.subtitle.id = id;
    });

    sidebar.onMessage(PluginEvent.BROWSE, async () => {
        const dirPath = await utils.chooseFile("Select destination folder", { chooseDir: true });
        if (dirPath?.length > 0)
            sidebar.postMessage(PluginEvent.DIR_CHANGE, dirPath.replace('file://', ''));
    });

    sidebar.onMessage(PluginEvent.CHECK_PATH, ({ dirPath, filename }) => {
        const dirExists = dirPath && file.exists(dirPath);
        const fileExists = dirExists && filename && file.exists(filePath(dirPath, filename));

        sidebar.postMessage(PluginEvent.PATH_STATUS, {
            dirExists: !!dirExists,
            fileExists: !!fileExists
        });
    });

    sidebar.onMessage(PluginEvent.SAVE, saveSubs);

    registerMenuItem();
    console.log("Save Subtitles plugin loaded");
});