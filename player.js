(() => {
  'use strict';

  const get = (id) => document.getElementById(id);
  const data = window.LECTURE_DATA;
  const audio = get('lecture-audio');
  const video = get('visual-video');
  let image = get('main-image');
  const qaView = get('qa-view');
  const stage = get('stage');
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
  const transcriptHeading = followToggle.parentElement;
  const workspace = get('workspace');
  const downloads = get('download-dialog');
  const subtitleToggle = get('subtitle-toggle');
  const subtitleBand = get('subtitle-band');
  const subtitleLine = get('subtitle-line');
  const stageExpand = get('stage-expand');
  const mobileBar = get('mobile-bar');
  const mobile = matchMedia('(max-width: 850px), (max-width: 1024px) and (orientation: landscape) and (max-height: 540px) and (pointer: coarse)');

  get('download-open').addEventListener('click', () => downloads.showModal());
  if (!data) {
    stageMessage.textContent = '讲座索引未能载入，可在下载面板获取录音。';
    return;
  }
  video.muted = true;
  const nextFrame = new Image();
  nextFrame.fetchPriority = 'low';

  let duration = data.duration;
  let pendingSeek = null;
  let activeMedia = -1;
  let activeCue = -1;
  let activeSubtitle = -1;
  let visualKey = '';
  let currentClip = null;
  let follow = true;
  let audioRunning = false;
  let videoPlayPending = null;
  let videoPlayDenied = false;
  let scrubbing = false;
  let scrubPosition = null;
  let mobilePanel = 'transcript';
  const subtitles = data.subtitles ?? [];
  const mobilePanes = [
    { name: 'transcript', tab: get('tab-transcript'), panel: get('transcript-panel'), heading: 'transcript-label' },
    { name: 'slides', tab: get('tab-slides'), panel: get('slides-panel'), heading: 'slides-label' }
  ];
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

  function reveal(container, row) {
    if (!row || !container.clientHeight) return;
    const view = container.getBoundingClientRect();
    const item = row.getBoundingClientRect();
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

  function showMobilePanel(name, focus = false) {
    mobilePanel = name;
    for (const pane of mobilePanes) {
      const selected = pane.name === name;
      pane.tab.setAttribute('aria-selected', String(selected));
      pane.tab.tabIndex = selected ? 0 : -1;
      pane.panel.hidden = !selected;
      if (selected && focus) pane.tab.focus();
    }
    followToggle.hidden = name !== 'transcript';
    if (name === 'slides') reveal(slideList, slideButtons[activeMedia]);
    else if (follow) reveal(transcriptScroll, cueButtons[activeCue]);
  }

  function applyLayout() {
    mobileBar.hidden = !mobile.matches;
    for (const pane of mobilePanes) {
      pane.panel.hidden = false;
      if (mobile.matches) pane.panel.setAttribute('role', 'tabpanel');
      else pane.panel.removeAttribute('role');
      pane.panel.setAttribute('aria-labelledby', mobile.matches ? pane.tab.id : pane.heading);
    }
    if (mobile.matches) {
      mobileBar.append(followToggle);
      showMobilePanel(mobilePanel);
    } else {
      transcriptHeading.append(followToggle);
      followToggle.hidden = false;
    }
    placeMarkers();
  }

  function showPreview(entry, time = entry.at) {
    const width = timeline.clientWidth;
    const thumb = get('preview-image');
    thumb.hidden = !entry.thumb;
    if (entry.thumb) thumb.src = entry.thumb;
    get('preview-time').textContent = formatTime(time);
    get('preview-title').textContent = entry.title;
    preview.hidden = false;
    const half = preview.offsetWidth / 2;
    const position = 7 + (width - 14) * (time / duration);
    const x = Math.min(width - half, Math.max(half, position));
    preview.style.setProperty('--preview-x', `${x}px`);
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
      marker.addEventListener('click', () => {
        if (mobile.matches) preview.hidden = true;
        jump(entry.at);
      });
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
    const picker = get('qa-topic-select');
    for (const topic of data.qaTopics) {
      const button = element('button', 'qa-link');
      button.type = 'button';
      button.append(element('span', '', formatTime(topic.at)), document.createTextNode(topic.title));
      button.addEventListener('click', () => jump(topic.at));
      links.append(button);
      const option = element('option', '', `${formatTime(topic.at)} · ${topic.title}`);
      option.value = String(topic.at);
      picker.append(option);
    }
    picker.addEventListener('change', () => {
      if (picker.value) jump(Number(picker.value));
      picker.selectedIndex = 0;
    });
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
    const gap = mobile.matches ? 8 : 12;
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
    video.removeAttribute('data-frame-ready');
    currentClip = null;
    videoPlayPending = null;
    if (video.hasAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
  }

  function syncVideo() {
    if (!currentClip || video.error) return;
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA && !video.seeking) {
      const time = pendingSeek ?? audio.currentTime;
      const target = Math.max(0, Math.min(time - currentClip.at, video.duration - 0.035));
      if (Math.abs(video.currentTime - target) > .32) {
        video.currentTime = target;
      } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        video.setAttribute('data-frame-ready', '');
        stageMessage.hidden = true;
      }
    }
    if (video.playbackRate !== audio.playbackRate) video.playbackRate = audio.playbackRate;
    if (!audioRunning || audio.seeking || audio.paused) {
      video.pause();
    } else if (video.paused && !video.ended && !videoPlayPending && !videoPlayDenied) {
      const attempt = video.play();
      videoPlayPending = attempt;
      attempt
        .catch((error) => {
          if (videoPlayPending === attempt && error.name !== 'AbortError') videoPlayDenied = true;
        })
        .finally(() => {
          if (videoPlayPending === attempt) videoPlayPending = null;
        });
    }
  }

  async function showStill(entry, source, key) {
    const frame = new Image();
    frame.src = source;
    try {
      await frame.decode();
    } catch {
      if (key !== visualKey) return false;
      frame.src = entry.thumb;
      try {
        await frame.decode();
      } catch {
        if (key === visualKey && image.hidden && !video.hasAttribute('data-frame-ready')) {
          stageMessage.textContent = '画面暂未载入';
          stageMessage.hidden = false;
        }
        return false;
      }
    }
    if (key !== visualKey) return false;
    // Swap only after decoding so the last visible frame covers the load.
    frame.id = image.id;
    frame.alt = entry.title;
    image.replaceWith(frame);
    image = frame;
    stageMessage.hidden = true;
    return true;
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
    qaView.hidden = !isQa;
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
    if (isQa) {
      releaseVideo();
      image.hidden = true;
      stageMessage.hidden = true;
      return;
    }

    image.hidden = !image.naturalWidth;
    stageMessage.textContent = '正在载入讲座画面';
    stageMessage.hidden = !image.hidden || video.hasAttribute('data-frame-ready');
    if (liveClip) {
      releaseVideo();
      stageMessage.hidden = !image.hidden;
      currentClip = entry;
      videoPlayDenied = false;
      showStill(entry, entry.poster, key);
      video.hidden = false;
      video.src = entry.src;
      video.preload = 'auto';
      video.load();
      syncVideo();
      nextFrame.src = entry.last;
      return;
    }

    // Hold the last video frame too, including at the end of a clip.
    currentClip = null;
    video.pause();
    showStill(entry, entry.kind === 'video' ? entry.last : entry.src, key).then((shown) => {
      if (shown && key === visualKey) releaseVideo();
    });
    const following = data.media[activeMedia + 1];
    const upcoming = following?.poster ?? following?.src;
    if (upcoming) nextFrame.src = upcoming;
  }

  function renderTransport(time) {
    get('current-time').textContent = formatTime(time);
    seek.setAttribute('aria-valuetext', `${formatTime(time)} / ${formatTime(duration)}`);
    if (!scrubbing) seek.value = String(time);
    timeline.style.setProperty('--progress', `${Math.min(100, time / duration * 100)}%`);
  }

  function render() {
    const time = pendingSeek ?? audio.currentTime;
    renderTransport(scrubPosition ?? time);
    const mediaIndex = Math.max(0, selectedAt(data.media, time + .015));
    if (mediaIndex !== activeMedia) {
      setCurrent(slideButtons, activeMedia, mediaIndex);
      setCurrent(markerButtons, activeMedia, mediaIndex);
      activeMedia = mediaIndex;
      reveal(slideList, slideButtons[activeMedia]);
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

    const subtitleIndex = selectedAt(subtitles, time);
    const subtitle = subtitles[subtitleIndex];
    const nextSubtitle = subtitle && time < subtitle.end ? subtitleIndex : -1;
    if (activeSubtitle !== nextSubtitle) {
      activeSubtitle = nextSubtitle;
      subtitleLine.textContent = nextSubtitle >= 0 ? subtitle.text : '';
    }
  }

  function finishScrub(commit) {
    if (!scrubbing) return;
    const position = scrubPosition;
    scrubbing = false;
    scrubPosition = null;
    preview.hidden = true;
    if (commit && position !== null) jump(position);
    else render();
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
  for (const pane of mobilePanes) pane.tab.addEventListener('click', () => showMobilePanel(pane.name));
  get('mobile-tabs').addEventListener('keydown', (event) => {
    if (event.key === 'Home') showMobilePanel('transcript', true);
    else if (event.key === 'End') showMobilePanel('slides', true);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      showMobilePanel(mobilePanel === 'transcript' ? 'slides' : 'transcript', true);
    } else return;
    event.preventDefault();
  });
  mobile.addEventListener('change', applyLayout);
  applyLayout();
  new ResizeObserver(placeMarkers).observe(markers);

  play.addEventListener('click', togglePlay);
  get('back').addEventListener('click', () => jump((pendingSeek ?? audio.currentTime) - 15));
  get('forward').addEventListener('click', () => jump((pendingSeek ?? audio.currentTime) + 15));
  seek.addEventListener('pointerdown', () => { scrubbing = true; });
  window.addEventListener('pointerup', () => finishScrub(true));
  seek.addEventListener('pointercancel', () => finishScrub(false));
  seek.addEventListener('input', () => {
    const time = seek.valueAsNumber;
    if (mobile.matches && scrubbing) {
      scrubPosition = time;
      renderTransport(time);
      showPreview(data.media[Math.max(0, selectedAt(data.media, time))], time);
    } else {
      jump(time);
    }
  });
  seek.addEventListener('change', () => finishScrub(true));

  subtitleToggle.addEventListener('click', () => {
    subtitleBand.hidden = !subtitleBand.hidden;
    subtitleToggle.setAttribute('aria-pressed', String(!subtitleBand.hidden));
    subtitleToggle.title = subtitleBand.hidden ? '开启字幕' : '关闭字幕';
  });

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

  stageExpand.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (stage.requestFullscreen && document.fullscreenEnabled) {
      stage.requestFullscreen().catch(() => {});
    } else {
      const entry = data.media[activeMedia];
      if (entry.kind !== 'qa') window.open(entry.src, '_blank', 'noopener');
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const label = document.fullscreenElement === stage ? '退出全屏' : '全屏查看画面';
    stageExpand.setAttribute('aria-label', label);
    stageExpand.title = label;
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
  for (const event of ['loadedmetadata', 'loadeddata', 'canplay', 'seeked']) video.addEventListener(event, syncVideo);
  video.addEventListener('error', () => {
    if (!currentClip || !video.error) return;
    video.removeAttribute('data-frame-ready');
    video.hidden = true;
    if (image.hidden) {
      stageMessage.textContent = '视频载入失败，继续播放主录音';
      stageMessage.hidden = false;
    }
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
    if (!mobile.matches && stage.clientWidth < 338) {
      workspace.style.removeProperty('--left-width');
      workspace.style.removeProperty('--right-width');
    }
  });

  render();
})();
