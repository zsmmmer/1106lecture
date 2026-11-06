(() => {
  'use strict';

  const get = (id) => document.getElementById(id);
  const data = window.LECTURE_DATA;
  const audio = get('lecture-audio');
  const video = get('visual-video');
  const image = get('main-image');
  const visual = get('visual');
  const status = get('playback-status');
  const stageMessage = get('stage-message');
  const play = get('play-toggle');
  const seek = get('seek');
  const slideList = get('slide-list');
  const transcriptScroll = get('transcript-scroll');
  const markers = get('markers');
  const timeline = get('timeline');
  const preview = get('marker-preview');
  const followToggle = get('follow-toggle');
  const workspace = get('workspace');
  const downloads = get('download-dialog');

  get('download-open').addEventListener('click', () => downloads.showModal());
  if (!data) {
    stageMessage.textContent = '讲座索引未能载入，可在下载面板获取录音。';
    return;
  }

  let duration = data.duration;
  let pendingSeek = null;
  let activeMedia = -1;
  let activeCue = -1;
  let visualKey = '';
  let currentClip = null;
  let follow = true;
  let audioRunning = false;
  let videoPlayPending = false;
  let videoPlayDenied = false;
  let scrubbing = false;
  const slideButtons = [];
  const cueButtons = [];
  const markerButtons = [];

  const formatTime = (seconds) => {
    const time = Math.max(0, Math.floor(seconds));
    const h = Math.floor(time / 3600);
    const m = Math.floor(time / 60) % 60;
    const s = String(time % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`;
  };

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function selectedAt(records, time) {
    let left = 0;
    let right = records.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (records[middle].at <= time) left = middle + 1;
      else right = middle;
    }
    return left - 1;
  }

  function reveal(container, row, horizontal = false) {
    if (!row) return;
    const view = container.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    if (horizontal) {
      if (item.left < view.left || item.right > view.right) {
        container.scrollLeft += item.left - view.left - 10;
      }
      return;
    }
    if (item.top < view.top + 4 || item.bottom > view.bottom - 6) {
      container.scrollTop += item.top - view.top - Math.min(view.height * .23, 80);
    }
  }

  function setCurrent(list, previous, next) {
    if (previous >= 0) list[previous].removeAttribute('aria-current');
    if (next >= 0) list[next].setAttribute('aria-current', 'true');
  }

  function jump(time) {
    const seconds = Math.max(0, Math.min(time, duration));
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      audio.currentTime = seconds;
    } else {
      pendingSeek = seconds;
    }
    render();
  }

  function setFollow(value) {
    follow = value;
    followToggle.setAttribute('aria-pressed', String(follow));
    followToggle.title = follow ? '暂停自动跟随' : '恢复自动跟随';
    if (follow) reveal(transcriptScroll, cueButtons[activeCue]);
  }

  function showPreview(entry) {
    const width = timeline.clientWidth;
    const position = 7 + (width - 14) * (entry.at / duration);
    const x = Math.min(width - 94, Math.max(94, position));
    const thumb = get('preview-image');
    thumb.hidden = !entry.thumb;
    if (entry.thumb) thumb.src = entry.thumb;
    get('preview-time').textContent = formatTime(entry.at);
    get('preview-title').textContent = entry.title;
    preview.style.setProperty('--preview-x', `${x}px`);
    preview.hidden = false;
  }

  function buildSlides() {
    let chapter = '';
    let chapterNumber = 0;
    for (const entry of data.media) {
      if (entry.chapter !== chapter) {
        chapter = entry.chapter;
        chapterNumber++;
        const heading = element('h3', 'chapter-heading');
        heading.append(element('span', '', String(chapterNumber).padStart(2, '0')), document.createTextNode(chapter));
        slideList.append(heading);
      }
      const button = element('button', 'slide-card');
      button.type = 'button';
      button.title = `${formatTime(entry.at)} · ${entry.title}`;
      const thumbnail = element('span', 'slide-thumb');
      if (entry.thumb) {
        const thumb = element('img');
        thumb.src = entry.thumb;
        thumb.alt = '';
        thumb.loading = 'lazy';
        thumb.decoding = 'async';
        thumbnail.append(thumb);
      } else {
        thumbnail.classList.add('qa-thumb');
        thumbnail.textContent = '问答';
      }
      if (entry.kind === 'video') {
        const chip = element('span', 'kind-chip', '▶');
        chip.setAttribute('aria-label', '视频');
        thumbnail.append(chip);
      }
      const text = element('span', 'slide-text');
      text.append(element('time', 'slide-time', formatTime(entry.at)), element('span', 'slide-title', entry.title));
      button.append(thumbnail, text);
      button.addEventListener('click', () => jump(entry.at));
      slideButtons.push(button);
      slideList.append(button);

      const marker = element('button', 'marker');
      marker.type = 'button';
      marker.dataset.kind = entry.kind;
      marker.style.setProperty('--at', `${(entry.at / duration) * 100}%`);
      marker.setAttribute('aria-label', `${formatTime(entry.at)} ${entry.title}`);
      marker.addEventListener('pointerenter', () => showPreview(entry));
      marker.addEventListener('pointerleave', () => { preview.hidden = true; });
      marker.addEventListener('focus', () => showPreview(entry));
      marker.addEventListener('blur', () => { preview.hidden = true; });
      marker.addEventListener('click', () => jump(entry.at));
      markerButtons.push(marker);
      markers.append(marker);
    }
    const qa = data.media.find((entry) => entry.kind === 'qa');
    if (qa) {
      get('qa-jump').textContent = `${formatTime(qa.at)} 问答`;
      get('qa-jump').addEventListener('click', () => jump(qa.at));
      timeline.style.setProperty('--qa-position', `${qa.at / duration * 100}%`);
    }
    get('slide-count').textContent = `${data.media.length - (qa ? 1 : 0)} 项`;
  }

  function buildTranscript() {
    const list = get('transcript-list');
    const rows = document.createDocumentFragment();
    for (const cue of data.cues) {
      const li = element('li');
      const button = element('button', 'cue');
      button.type = 'button';
      const head = element('span', 'cue-head');
      head.append(element('time', 'cue-time', formatTime(cue.at)));
      if (cue.role) head.append(element('span', 'cue-role', cue.role));
      const text = element('span', 'cue-text');
      for (const part of cue.text.split(/(〔[^〕]+〕)/)) {
        if (part.startsWith('〔')) text.append(element('span', 'unclear', part));
        else text.append(document.createTextNode(part));
      }
      button.append(head, text);
      button.addEventListener('click', () => jump(cue.at));
      li.append(button);
      rows.append(li);
      cueButtons.push(button);
    }
    list.append(rows);
  }

  function buildQaLinks() {
    const links = get('qa-links');
    for (const topic of data.qaTopics) {
      const button = element('button', 'qa-link');
      button.type = 'button';
      button.append(element('span', '', formatTime(topic.at)), document.createTextNode(topic.title));
      button.addEventListener('click', () => jump(topic.at));
      links.append(button);
    }
  }

  function buildDownloads() {
    const list = get('clip-downloads');
    list.append(element('h3', '', '现场演示视频'));
    for (const entry of data.media.filter((item) => item.kind === 'video')) {
      const link = element('a');
      link.href = entry.src;
      link.download = `塔蕴数智-${entry.id}.mp4`;
      const label = element('span');
      label.append(element('strong', '', entry.title), element('small', '', `${formatTime(entry.at)} · 片长 ${formatTime(entry.duration)}`));
      link.append(label, element('span', '', 'MP4 ↓'));
      list.append(link);
    }
  }

  function placeMarkers() {
    const endOfLane = [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity];
    const width = markers.clientWidth;
    const gap = matchMedia('(max-width: 850px)').matches ? 8 : 12;
    for (const [i, entry] of data.media.entries()) {
      const x = width * entry.at / duration;
      let lane = endOfLane.findIndex((end) => x - end >= gap);
      if (lane < 0) lane = endOfLane.indexOf(Math.min(...endOfLane));
      markerButtons[i].style.setProperty('--lane', lane);
      endOfLane[lane] = x;
    }
  }

  function releaseVideo() {
    video.pause();
    video.hidden = true;
    currentClip = null;
    if (video.hasAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
  }

  function syncVideo() {
    if (!currentClip || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const time = pendingSeek ?? audio.currentTime;
    const target = Math.max(0, Math.min(time - currentClip.at, video.duration - 0.035));
    if (Math.abs(video.currentTime - target) > .32) video.currentTime = target;
    if (video.playbackRate !== audio.playbackRate) video.playbackRate = audio.playbackRate;
    if (!audioRunning || audio.seeking || audio.paused) {
      video.pause();
    } else if (video.paused && !videoPlayPending && !videoPlayDenied) {
      videoPlayPending = true;
      video.play()
        .catch((error) => {
          if (error.name === 'NotAllowedError') videoPlayDenied = true;
        })
        .finally(() => { videoPlayPending = false; });
    }
  }

  function showMedia(entry, time) {
    const liveClip = entry.kind === 'video' && time < entry.at + entry.duration;
    const key = `${entry.id}:${liveClip}`;
    if (visualKey === key) {
      syncVideo();
      return;
    }
    visualKey = key;
    const isQa = entry.kind === 'qa';
    get('qa-view').hidden = !isQa;
    stageMessage.hidden = true;
    const currentDownload = get('current-download');
    currentDownload.hidden = isQa;
    if (!isQa) {
      currentDownload.href = entry.src;
      currentDownload.download = `塔蕴数智-${entry.id}.${entry.kind === 'video' ? 'mp4' : 'webp'}`;
    }
    get('stage-type').textContent = isQa ? '现场交流' : liveClip ? '演示视频' : entry.kind === 'video' ? '视频末帧' : '现场课件';
    get('caption-time').textContent = formatTime(entry.at);
    get('caption-chapter').textContent = entry.chapter;
    get('caption-title').textContent = isQa ? '现场交流' : entry.title;
    get('caption-note').textContent = entry.note || '';
    if (liveClip) {
      releaseVideo();
      currentClip = entry;
      videoPlayDenied = false;
      image.hidden = true;
      video.hidden = false;
      video.poster = entry.poster;
      video.src = entry.src;
      video.preload = 'auto';
      video.load();
      return;
    }
    releaseVideo();
    image.hidden = isQa;
    if (!isQa) {
      image.src = entry.kind === 'video' ? entry.last : entry.src;
      image.alt = entry.title;
    }
  }

  function render() {
    const time = pendingSeek ?? audio.currentTime;
    get('current-time').textContent = formatTime(time);
    seek.setAttribute('aria-valuetext', `${formatTime(time)} / ${formatTime(duration)}`);
    if (!scrubbing) seek.value = String(time);
    timeline.style.setProperty('--progress', `${Math.min(100, time / duration * 100)}%`);

    const mediaIndex = Math.max(0, selectedAt(data.media, time + .015));
    if (mediaIndex !== activeMedia) {
      setCurrent(slideButtons, activeMedia, mediaIndex);
      setCurrent(markerButtons, activeMedia, mediaIndex);
      activeMedia = mediaIndex;
      reveal(slideList, slideButtons[activeMedia], matchMedia('(max-width: 850px)').matches);
    }
    showMedia(data.media[activeMedia], time);

    const cueIndex = selectedAt(data.cues, time + .015);
    const cue = data.cues[cueIndex];
    const next = cue && time <= cue.end + 1.1 ? cueIndex : -1;
    if (activeCue !== next) {
      setCurrent(cueButtons, activeCue, next);
      activeCue = next;
      if (follow) reveal(transcriptScroll, cueButtons[activeCue]);
      if (data.media[activeMedia].kind === 'qa') {
        get('caption-title').textContent = data.cues[activeCue]?.role || '现场交流';
      }
    }
  }

  function togglePlay() {
    if (audio.paused) {
      if (audio.ended) jump(0);
      audio.play().catch(() => { status.textContent = '录音无法播放，请重试或下载录音。'; });
    } else {
      audio.pause();
    }
  }

  function paintPlayState() {
    const playing = !audio.paused && !audio.ended;
    document.body.classList.toggle('is-playing', playing);
    get('avatar').classList.toggle('is-speaking', audioRunning && playing);
    play.setAttribute('aria-label', playing ? '暂停' : '播放');
    render();
  }

  buildSlides();
  buildTranscript();
  buildQaLinks();
  buildDownloads();
  new ResizeObserver(placeMarkers).observe(markers);

  play.addEventListener('click', togglePlay);
  get('back').addEventListener('click', () => jump((pendingSeek ?? audio.currentTime) - 15));
  get('forward').addEventListener('click', () => jump((pendingSeek ?? audio.currentTime) + 15));
  seek.addEventListener('pointerdown', () => { scrubbing = true; });
  window.addEventListener('pointerup', () => { scrubbing = false; });
  seek.addEventListener('pointercancel', () => { scrubbing = false; });
  seek.addEventListener('input', () => jump(seek.valueAsNumber));
  seek.addEventListener('change', () => { scrubbing = false; render(); });

  for (const name of ['wheel', 'touchmove']) {
    transcriptScroll.addEventListener(name, () => setFollow(false), { passive: true });
  }
  transcriptScroll.addEventListener('keydown', (event) => {
    if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) setFollow(false);
  });
  followToggle.addEventListener('click', () => setFollow(!follow));

  get('rate').addEventListener('change', (event) => {
    audio.playbackRate = Number(event.currentTarget.value);
    syncVideo();
  });
  get('mute').addEventListener('click', () => {
    if (audio.volume === 0) {
      audio.volume = 1;
      audio.muted = false;
    } else {
      audio.muted = !audio.muted;
    }
  });
  get('volume').addEventListener('input', (event) => {
    audio.volume = event.currentTarget.valueAsNumber;
    audio.muted = false;
  });
  audio.addEventListener('volumechange', () => {
    const muted = audio.muted || audio.volume === 0;
    get('mute').setAttribute('aria-pressed', String(muted));
    get('mute').setAttribute('aria-label', muted ? '取消静音' : '静音');
    get('volume').value = String(audio.volume);
  });

  get('stage-expand').addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (visual.requestFullscreen && document.fullscreenEnabled) {
      visual.requestFullscreen().catch(() => {});
    } else {
      const entry = data.media[activeMedia];
      if (entry.kind !== 'qa') window.open(entry.src, '_blank', 'noopener');
    }
  });

  audio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(audio.duration)) duration = audio.duration;
    seek.max = String(duration);
    get('total-time').textContent = formatTime(duration);
    if (pendingSeek !== null) {
      audio.currentTime = pendingSeek;
      pendingSeek = null;
    }
    render();
  });
  audio.addEventListener('play', paintPlayState);
  audio.addEventListener('playing', () => {
    audioRunning = true;
    videoPlayDenied = false;
    status.textContent = '';
    paintPlayState();
  });
  audio.addEventListener('waiting', () => {
    audioRunning = false;
    status.textContent = audio.paused ? '' : '正在缓冲';
    paintPlayState();
  });
  for (const event of ['pause', 'ended']) {
    audio.addEventListener(event, () => {
      audioRunning = false;
      status.textContent = '';
      paintPlayState();
    });
  }
  for (const event of ['timeupdate', 'seeking', 'seeked']) audio.addEventListener(event, render);
  audio.addEventListener('error', () => { status.textContent = '录音载入失败，可在下载面板获取文件。'; });
  video.addEventListener('loadedmetadata', syncVideo);
  video.addEventListener('canplay', syncVideo);
  video.addEventListener('error', () => {
    if (!currentClip) return;
    image.src = currentClip.poster;
    image.alt = currentClip.title;
    image.hidden = false;
    video.hidden = true;
    stageMessage.textContent = '视频载入失败，继续播放主录音';
    stageMessage.hidden = false;
  });

  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.repeat || event.defaultPrevented || downloads.open) return;
    if (event.target.closest?.('button, a, input, select, textarea, [tabindex], [contenteditable]')) return;
    event.preventDefault();
    togglePlay();
  });

  const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
  const splitters = [
    { id: 'left-resize', panel: 'slides-panel', variable: '--left-width', axis: 'col', direction: 1, min: 156, max: 430, other: 'transcript-panel' },
    { id: 'right-resize', panel: 'transcript-panel', variable: '--right-width', axis: 'col', direction: -1, min: 225, max: 600, other: 'slides-panel' },
    { id: 'bottom-resize', panel: 'transport', variable: '--transport-height', axis: 'row', direction: -1, min: 128, max: 310 }
  ];

  function bindSplitter(config) {
    const handle = get(config.id);
    const panel = get(config.panel);
    const row = config.axis === 'row';
    const coordinate = (event) => row ? event.clientY : event.clientX;
    const current = () => row ? panel.clientHeight : panel.clientWidth;
    const maximum = () => {
      const available = row ? workspace.clientHeight - 410 : workspace.clientWidth - get(config.other).clientWidth - 356;
      return clamp(available, config.min, config.max);
    };
    const paint = () => {
      handle.setAttribute('aria-valuemin', config.min);
      handle.setAttribute('aria-valuemax', maximum());
      handle.setAttribute('aria-valuenow', current());
      handle.setAttribute('aria-valuetext', `${current()} 像素`);
    };
    const resize = (value) => {
      workspace.style.setProperty(config.variable, `${clamp(value, config.min, maximum())}px`);
      paint();
    };
    let drag = null;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      drag = { id: event.pointerId, origin: coordinate(event), size: current() };
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('dragging');
      document.body.classList.add('dragging-layout', config.axis);
    });
    handle.addEventListener('pointermove', (event) => {
      if (drag?.id === event.pointerId) resize(drag.size + config.direction * (coordinate(event) - drag.origin));
    });
    handle.addEventListener('lostpointercapture', () => {
      drag = null;
      handle.classList.remove('dragging');
      document.body.classList.remove('dragging-layout', config.axis);
    });
    handle.addEventListener('keydown', (event) => {
      const before = row ? 'ArrowUp' : 'ArrowLeft';
      const after = row ? 'ArrowDown' : 'ArrowRight';
      if (event.key === 'Home') resize(config.min);
      else if (event.key === 'End') resize(maximum());
      else if (event.key === before) resize(current() - 18 * config.direction);
      else if (event.key === after) resize(current() + 18 * config.direction);
      else return;
      event.preventDefault();
    });
    handle.addEventListener('dblclick', () => {
      workspace.style.removeProperty(config.variable);
      paint();
    });
    new ResizeObserver(paint).observe(panel);
  }

  for (const splitter of splitters) bindSplitter(splitter);
  const masthead = document.querySelector('.masthead');
  new ResizeObserver(() => {
    workspace.style.setProperty('--masthead-height', `${masthead.offsetHeight}px`);
  }).observe(masthead);
  window.addEventListener('resize', () => {
    const stage = get('stage');
    if (window.innerWidth > 850 && stage.clientWidth < 338) {
      workspace.style.removeProperty('--left-width');
      workspace.style.removeProperty('--right-width');
    }
  });

  render();
})();
