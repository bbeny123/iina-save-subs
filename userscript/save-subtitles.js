const {core, mpv, utils, file, menu, console} = iina;

async function saveSubtitles() {
  if (!utils.fileInPath("/usr/bin/osascript")) {
    core.osd("Error: osascript not found");
    return;
  }

  const subsPath = currentSubsPath();
  if (!subsPath) return;

  let delay = getDelay();
  if (delay == null) return;

  const shifted = shiftSubtitles(subsPath, delay);
  if (!shifted) return;

  const {destPath, destName} = toDest(core.status?.url, subsPath);
  const outPath = await toOutPath(destPath, destName);
  if (!outPath) return;

  if (file.exists(outPath)) file.trash(outPath);

  file.write(outPath, shifted);
  core.subtitle.loadTrack(outPath);
  core.osd("Subtitles saved and loaded");
}

async function toOutPath(destPath, destName) {
  let arg = "POSIX path of (choose file name with prompt \"Save subtitles as:\"";
  if (destPath) arg += ` default location (POSIX file \"${destPath}\")`;
  if (destName) arg += ` default name \"${destName}\"`;
  arg += ")";

  const {stdout, stderr} = await utils.exec("/usr/bin/osascript", ["-e", arg]);

  if (stderr) {
    console.error(stderr);
    core.osd(`Error: ${stderr}`);
    return '';
  }

  let outPath = stdout?.trim();
  return !outPath || outPath.toLowerCase().endsWith('.srt') ? outPath : outPath + '.srt';
}

function toDest(filePath, subsPath) {
  let destPath, destName;

  if (filePath?.startsWith('file://')) {
    destPath = toDestPath(filePath.slice(7));
    destName = toDestName(filePath, toLangCode(subsPath));
  }

  destPath ||= toDestPath(subsPath);
  destName ||= toDestName(subsPath);
  destName ||= "subs.srt";

  return {destPath, destName};
}

function toDestPath(path) {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash !== -1 ? path.slice(0, lastSlash).trim() : path.trim();
}

function toDestName(path, langCode = '') {
  let filename = path.slice(path.lastIndexOf('/') + 1);
  filename = filename.substring(0, filename.lastIndexOf('.')) || filename;

  langCode = langCode && '.' + langCode;
  return filename.trim() + langCode + '.srt';
}

function toLangCode(subsPath) {
  const langCode = subsPath.split('.').at(-2)?.toLowerCase()?.trim() || '';
  return /^[a-z]{2,3}$/.test(langCode) ? langCode : '';
}

function currentSubsPath() {
  const subsPath = mpv.getString("current-tracks/sub/external-filename")?.trim();

  if (!subsPath) {
    core.osd("Error: No active external subtitles track found");
  } else if (core.subtitle.currentTrack?.codec !== "subrip") {
    core.osd("Error: Only SRT subtitles are supported");
  } else if (!file.exists(subsPath)) {
    core.osd("Error: Subtitle file doesn't exist");
  } else {
    return subsPath;
  }

  return '';
}

function shiftSubtitles(subsPath, delay) {
  const lines = file.read(subsPath).split('\n');
  lines.push('');

  const shifted = [];
  let subIndex = 1;
  let skip = true;

  let line = lines[0].trim();
  for (let i = 1; i < lines.length; i++) {
    const nextLine = lines[i].trim();
    const match = nextLine.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);

    if (match) {
      const newStartMs = toMs(delay, ...match.slice(1, 5));
      const newEndMs = toMs(delay, ...match.slice(5, 9));

      skip = newStartMs < 0;
      if (skip) continue;

      shifted.push((subIndex++).toString());
      shifted.push(`${toTimestamp(newStartMs)} --> ${toTimestamp(newEndMs)}`);
      line = lines[++i].trim();
    } else if (!skip) {
      shifted.push(line);
      line = nextLine;
    }
  }

  if (subIndex < 2) {
    core.osd("Error: No subtitles to save");
    return '';
  }

  shifted.length = shifted.findLastIndex(line => line !== '') + 1;
  shifted.push('', '');

  return shifted.join('\r\n');
}

function toMs(shift, hh, mm, ss, ms) {
  return +hh * 3600000 + +mm * 60000 + +ss * 1000 + +ms + shift;
}

function toTimestamp(totalMs) {
  const hh = Math.floor(totalMs / 3600000);
  const mm = Math.floor((totalMs % 3600000) / 60000);
  const ss = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;

  return `${pad(hh)}:${pad(mm)}:${pad(ss)},${pad(ms, 3)}`;
}

function pad(n, pad = 2) {
  return n.toString().padStart(pad, '0');
}

function getDelay() {
  let delay = (core.subtitle.delay * 1000).toFixed(0);
  delay = utils.prompt(`Delay (ms):\nDefault: ${delay}`)?.trim() || delay;
  delay = parseInt(delay, 10);
  if (isNaN(delay)) {
    core.osd("Error: Invalid delay");
    return null;
  }

  return delay;
}

menu.addItem(
  menu.item(
    "Save subtitles...",
    saveSubtitles,
    {
      keyBinding: "Meta+d",
    },
  ),
);
