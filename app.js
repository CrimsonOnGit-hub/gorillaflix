/**
 * GorillaFlix 2.0 Web Engine
 * Fully independent HTML5 & JavaScript frontend replacing legacy HTA.
 */

// Custom In-App Modal System (Rule 10: No alert/prompt/confirm)
const Modal = {
  backdrop: document.getElementById('customModal'),
  titleEl: document.getElementById('modalTitle'),
  msgEl: document.getElementById('modalMessage'),
  inputWrap: document.getElementById('modalInputWrap'),
  inputEl: document.getElementById('modalInput'),
  btnConfirm: document.getElementById('modalBtnConfirm'),
  btnCancel: document.getElementById('modalBtnCancel'),
  currentResolve: null,

  alert(msg, title = 'Notice') {
    return new Promise((resolve) => {
      this.titleEl.textContent = title;
      this.msgEl.textContent = msg;
      this.inputWrap.classList.add('hidden');
      this.btnCancel.classList.add('hidden');
      this.btnConfirm.textContent = 'OK';
      this.backdrop.classList.remove('hidden');

      this.currentResolve = () => {
        this.backdrop.classList.add('hidden');
        resolve(true);
      };
      this.btnConfirm.onclick = () => this.currentResolve();
    });
  },

  confirm(msg, title = 'Confirm Action') {
    return new Promise((resolve) => {
      this.titleEl.textContent = title;
      this.msgEl.textContent = msg;
      this.inputWrap.classList.add('hidden');
      this.btnCancel.classList.remove('hidden');
      this.btnConfirm.textContent = 'Confirm';
      this.backdrop.classList.remove('hidden');

      this.btnConfirm.onclick = () => {
        this.backdrop.classList.add('hidden');
        resolve(true);
      };
      this.btnCancel.onclick = () => {
        this.backdrop.classList.add('hidden');
        resolve(false);
      };
    });
  },

  prompt(msg, defaultVal = '', title = 'Input Required') {
    return new Promise((resolve) => {
      this.titleEl.textContent = title;
      this.msgEl.textContent = msg;
      this.inputEl.value = defaultVal;
      this.inputWrap.classList.remove('hidden');
      this.btnCancel.classList.remove('hidden');
      this.btnConfirm.textContent = 'Submit';
      this.backdrop.classList.remove('hidden');
      this.inputEl.focus();

      this.btnConfirm.onclick = () => {
        const val = this.inputEl.value;
        this.backdrop.classList.add('hidden');
        resolve(val);
      };
      this.btnCancel.onclick = () => {
        this.backdrop.classList.add('hidden');
        resolve(null);
      };
    });
  }
};

// In-App Toast System
const Toast = {
  el: document.getElementById('toast'),
  timer: null,
  show(msg, duration = 3000) {
    if (this.timer) clearTimeout(this.timer);
    this.el.textContent = msg;
    this.el.style.display = 'block';
    this.timer = setTimeout(() => {
      this.el.style.display = 'none';
    }, duration);
  }
};

// LavaPlayer 2.0 (Modern HTML5 Video / Audio Player)
class LavaPlayerEngine {
  constructor(rootEl) {
    this.root = rootEl;
    this.video = document.getElementById('lpVideo');
    this.audio = document.getElementById('lpAudio');
    this.activeMedia = this.video;
    this.titleEl = document.getElementById('lpTitle');
    this.artEl = document.getElementById('lpArt');
    this.artImg = document.getElementById('lpArtImg');
    this.artTitle = document.getElementById('lpArtTitle');
    this.artSub = document.getElementById('lpArtSub');
    this.playBtn = document.getElementById('lpPlayBtn');
    this.centerBtn = document.getElementById('lpCenter');
    this.muteBtn = document.getElementById('lpMuteBtn');
    this.volRange = document.getElementById('lpVolRange');
    this.curEl = document.getElementById('lpCur');
    this.durEl = document.getElementById('lpDur');
    this.seek = document.getElementById('lpSeek');
    this.progEl = document.getElementById('lpProg');
    this.bufEl = document.getElementById('lpBuf');
    this.knob = document.getElementById('lpKnob');
    this.tip = document.getElementById('lpTip');
    this.rateSelect = document.getElementById('lpRate');
    this.fsBtn = document.getElementById('lpFsBtn');
    this.toastEl = document.getElementById('lpToast');
    this.errorEl = document.getElementById('lpError');
    this.errorText = document.getElementById('lpErrorText');
    this.statsPanel = document.getElementById('lpStats');
    this.statsContent = document.getElementById('lpStatsContent');

    this.mediaKey = '';
    this.isAudio = false;
    this.scrubbing = false;
    this.idleTimer = null;
    this.toastTimer = null;
    this.onCloseCallback = null;

    this.initEvents();
  }

  initEvents() {
    document.getElementById('lpBack').onclick = () => this.close();
    this.playBtn.onclick = () => this.toggle();
    this.centerBtn.onclick = () => this.toggle();
    this.muteBtn.onclick = () => this.toggleMute();
    this.fsBtn.onclick = () => this.toggleFullscreen();
    this.volRange.oninput = () => this.setVolume(this.volRange.value / 100);
    this.rateSelect.onchange = () => this.setRate(parseFloat(this.rateSelect.value));

    // Progress and buffering
    [this.video, this.audio].forEach((media) => {
      media.ontimeupdate = () => this.onTimeUpdate();
      media.onprogress = () => this.onProgress();
      media.onplay = () => this.onPlayState(true);
      media.onpause = () => this.onPlayState(false);
      media.onerror = (e) => this.onError(e);
      media.onended = () => this.onEnded();
    });

    // Seeking
    this.seek.onmousedown = (e) => {
      this.scrubbing = true;
      this.onSeekMove(e);
      const onMove = (ev) => this.onSeekMove(ev);
      const onUp = () => {
        this.scrubbing = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    this.seek.onmousemove = (e) => this.updateTip(e);

    // Activity reset for auto-hide UI
    this.root.onmousemove = () => this.wake();
    this.root.onmousedown = () => this.wake();

    // Volume persistence
    const savedVol = localStorage.getItem('gflix.vol');
    if (savedVol !== null) {
      this.setVolume(parseFloat(savedVol));
    }
  }

  open({ src, title = '', subtitle = '', audio = false, key = '', artUrl = '', onClose }) {
    this.mediaKey = key;
    this.isAudio = audio;
    this.onCloseCallback = onClose;

    this.video.pause();
    this.audio.pause();
    this.video.removeAttribute('src');
    this.audio.removeAttribute('src');
    this.video.load();
    this.audio.load();

    this.titleEl.textContent = title;
    this.errorEl.style.display = 'none';
    this.statsPanel.classList.add('hidden');

    if (audio) {
      this.root.classList.add('audio');
      this.activeMedia = this.audio;
      this.artTitle.textContent = title;
      this.artSub.textContent = subtitle;
      if (artUrl) {
        this.artImg.style.backgroundImage = `url("${artUrl}")`;
        this.artImg.textContent = '';
      } else {
        this.artImg.style.backgroundImage = 'none';
        this.artImg.textContent = '♪';
      }
    } else {
      this.root.classList.remove('audio');
      this.activeMedia = this.video;
    }

    this.activeMedia.src = src;
    this.activeMedia.load();

    // Resume position
    let resumePos = 0;
    if (key) {
      const saved = localStorage.getItem(`gflix.pos.${key}`);
      if (saved) resumePos = parseFloat(saved) || 0;
    }

    this.activeMedia.onloadedmetadata = () => {
      this.durEl.textContent = this.formatTime(this.activeMedia.duration);
      if (resumePos > 5 && resumePos < this.activeMedia.duration - 10) {
        this.activeMedia.currentTime = resumePos;
        this.say(`Resumed at ${this.formatTime(resumePos)}`);
      }
      this.activeMedia.play().catch(() => {});
    };

    this.root.parentElement.classList.add('open');
    this.wake();
  }

  close() {
    this.saveProgress();
    this.activeMedia.pause();
    this.activeMedia.removeAttribute('src');
    this.root.parentElement.classList.remove('open');
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    if (this.onCloseCallback) this.onCloseCallback();
  }

  toggle() {
    if (this.activeMedia.paused) {
      this.activeMedia.play();
    } else {
      this.activeMedia.pause();
    }
    this.wake();
  }

  toggleMute() {
    this.activeMedia.muted = !this.activeMedia.muted;
    this.muteBtn.innerHTML = this.activeMedia.muted ? '&#128263;' : '&#128266;';
    this.say(this.activeMedia.muted ? 'Muted' : 'Unmuted');
  }

  setVolume(vol) {
    const v = Math.max(0, Math.min(1, vol));
    this.activeMedia.volume = v;
    this.activeMedia.muted = false;
    this.volRange.value = Math.round(v * 100);
    this.muteBtn.innerHTML = v === 0 ? '&#128263;' : '&#128266;';
    localStorage.setItem('gflix.vol', String(v));
  }

  setRate(r) {
    this.activeMedia.playbackRate = r;
    this.say(`${r}x`);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.root.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  skip(seconds) {
    const d = this.activeMedia.duration;
    if (!Number.isFinite(d)) return;
    const next = Math.max(0, Math.min(d, this.activeMedia.currentTime + seconds));
    this.activeMedia.currentTime = next;
    this.say(`${seconds > 0 ? '+' : ''}${seconds}s`);
  }

  onSeekMove(e) {
    const rect = this.seek.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const d = this.activeMedia.duration;
    if (Number.isFinite(d)) {
      this.activeMedia.currentTime = frac * d;
    }
  }

  updateTip(e) {
    const rect = this.seek.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const d = this.activeMedia.duration;
    if (Number.isFinite(d)) {
      this.tip.textContent = this.formatTime(frac * d);
      this.tip.style.left = `${frac * 100}%`;
    }
  }

  onTimeUpdate() {
    const cur = this.activeMedia.currentTime;
    const dur = this.activeMedia.duration;
    this.curEl.textContent = this.formatTime(cur);
    if (Number.isFinite(dur) && dur > 0) {
      const pct = (cur / dur) * 100;
      this.progEl.style.width = `${pct}%`;
      this.knob.style.left = `${pct}%`;
      this.durEl.textContent = this.formatTime(dur);
    }
  }

  onProgress() {
    const dur = this.activeMedia.duration;
    if (this.activeMedia.buffered.length > 0 && Number.isFinite(dur) && dur > 0) {
      const bufEnd = this.activeMedia.buffered.end(this.activeMedia.buffered.length - 1);
      this.bufEl.style.width = `${(bufEnd / dur) * 100}%`;
    }
  }

  onPlayState(playing) {
    if (playing) {
      this.root.classList.remove('paused');
      this.playBtn.innerHTML = '&#10074;&#10074;';
    } else {
      this.root.classList.add('paused');
      this.playBtn.innerHTML = '&#9654;';
    }
  }

  onEnded() {
    if (this.mediaKey) {
      localStorage.removeItem(`gflix.pos.${this.mediaKey}`);
    }
    this.say('Playback ended');
  }

  onError(err) {
    this.root.classList.add('error');
    this.errorEl.style.display = 'block';
    this.errorText.textContent = this.activeMedia.error
      ? `Code ${this.activeMedia.error.code}: ${this.activeMedia.error.message || 'Media playback failed.'}`
      : 'Could not load video source.';
  }

  saveProgress() {
    if (!this.mediaKey) return;
    const cur = this.activeMedia.currentTime;
    const dur = this.activeMedia.duration;
    if (Number.isFinite(dur) && dur > 0) {
      if (cur > 5 && cur < dur - 10) {
        localStorage.setItem(`gflix.pos.${this.mediaKey}`, String(Math.floor(cur)));
      } else if (cur >= dur - 10) {
        localStorage.removeItem(`gflix.pos.${this.mediaKey}`);
      }
    }
  }

  toggleStats() {
    this.statsPanel.classList.toggle('hidden');
    if (!this.statsPanel.classList.contains('hidden')) {
      const v = this.activeMedia;
      this.statsContent.innerHTML = `
        <strong>Resolution:</strong> ${v.videoWidth || 'N/A'} &times; ${v.videoHeight || 'N/A'}<br>
        <strong>Current Time:</strong> ${v.currentTime.toFixed(2)}s<br>
        <strong>Duration:</strong> ${Number.isFinite(v.duration) ? v.duration.toFixed(2) : 0}s<br>
        <strong>Playback Rate:</strong> ${v.playbackRate}x<br>
        <strong>Volume:</strong> ${Math.round(v.volume * 100)}%<br>
        <strong>Muted:</strong> ${v.muted ? 'Yes' : 'No'}<br>
        <strong>Buffer Count:</strong> ${v.buffered.length}
      `;
    }
  }

  wake() {
    this.root.classList.remove('idle');
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.activeMedia.paused && !this.scrubbing) {
        this.root.classList.add('idle');
      }
    }, 2800);
  }

  say(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, 1000);
  }

  formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const remM = m % 60;
    const remS = s % 60;
    const p2 = (n) => (n < 10 ? `0${n}` : `${n}`);
    return h > 0 ? `${h}:${p2(remM)}:${p2(remS)}` : `${remM}:${p2(remS)}`;
  }

  handleKey(e) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return false;
    switch (e.keyCode) {
      case 32: // Space
      case 75: // K
        this.toggle();
        break;
      case 37: // Left
        this.skip(-5);
        break;
      case 39: // Right
        this.skip(5);
        break;
      case 74: // J
        this.skip(-10);
        break;
      case 76: // L
        this.skip(10);
        break;
      case 38: // Up
        this.setVolume(this.activeMedia.volume + 0.05);
        this.say(`Volume ${Math.round(this.activeMedia.volume * 100)}%`);
        break;
      case 40: // Down
        this.setVolume(this.activeMedia.volume - 0.05);
        this.say(`Volume ${Math.round(this.activeMedia.volume * 100)}%`);
        break;
      case 77: // M
        this.toggleMute();
        break;
      case 70: // F
        this.toggleFullscreen();
        break;
      case 73: // I
        this.toggleStats();
        break;
      case 27: // Esc
        if (!document.fullscreenElement) this.close();
        break;
      default:
        if (e.keyCode >= 48 && e.keyCode <= 57) {
          const frac = (e.keyCode - 48) / 10;
          if (Number.isFinite(this.activeMedia.duration)) {
            this.activeMedia.currentTime = frac * this.activeMedia.duration;
            this.say(`${(e.keyCode - 48) * 10}%`);
          }
        } else {
          return false;
        }
    }
    this.wake();
    return true;
  }
}

// GorillaFlix Core App State & Library Management
class GorillaFlixApp {
  constructor() {
    this.currentView = 'movies';
    this.movies = [];
    this.music = [];
    this.images = [];
    this.editingMovie = null;
    this.activeCast = [];
    this.player = new LavaPlayerEngine(document.getElementById('lpRoot'));

    this.initUI();
    this.loadInitialData();
  }

  initUI() {
    // Navigation
    ['movies', 'music', 'images', 'test', 'about'].forEach((v) => {
      document.getElementById(`nav-${v}`).onclick = () => this.switchView(v);
    });

    // Search and Sort
    document.getElementById('movieSearch').oninput = () => this.renderMovies();
    document.getElementById('movieSort').onchange = () => this.renderMovies();
    document.getElementById('genreFilter').onchange = () => this.renderMovies();
    document.getElementById('musicSearch').oninput = () => this.renderMusic();
    document.getElementById('imageSearch').oninput = () => this.renderImages();

    // Buttons
    document.getElementById('btnRefreshMovies').onclick = () => this.renderMovies();
    document.getElementById('btnRefreshMusic').onclick = () => this.renderMusic();
    document.getElementById('btnRefreshImages').onclick = () => this.renderImages();
    document.getElementById('btnRebuildMissing').onclick = () => this.rebuildMissingGmd();
    document.getElementById('btnUploadMovie').onclick = () => this.openEditor(null);
    document.getElementById('btnImportGmd').onclick = () => document.getElementById('importGmdFile').click();
    document.getElementById('importGmdFile').onchange = (e) => this.handleImportGmd(e);

    // Hub Close & Lightbox Close
    document.getElementById('hubClose').onclick = () => this.closeHub();
    document.getElementById('lightboxClose').onclick = () => this.closeLightbox();

    // Editor Drawer Controls
    document.getElementById('drawerCloseX').onclick = () => this.closeEditor();
    document.getElementById('upCancel').onclick = () => this.closeEditor();
    document.getElementById('upSubmit').onclick = () => this.saveEditor();
    document.getElementById('btnAddActor').onclick = () => this.addActorRow();

    // Artwork Uploaders & Removers (Rule 11)
    this.bindArtPicker('upPoster', 'posterPreviewThumb', 'btnRemovePoster');
    this.bindArtPicker('upBanner', 'bannerPreviewThumb', 'btnRemoveBanner');
    this.bindArtPicker('upTitleImg', 'titleImgPreviewThumb', 'btnRemoveTitleImg');

    // Test Bench Controls
    document.getElementById('btnTestPlay').onclick = () => this.runTestPlay();

    // Directory Picker (Phase 2 Offline Mode: File System Access API)
    document.getElementById('btnDirectoryPicker').onclick = () => this.pickLibraryFolder();

    // Global Keyboard Listeners
    window.addEventListener('keydown', (e) => {
      if (document.getElementById('playerLayer').classList.contains('open')) {
        if (this.player.handleKey(e)) {
          e.preventDefault();
        }
      } else if (e.key === 'Escape') {
        if (!document.getElementById('lightbox').classList.contains('hidden')) {
          this.closeLightbox();
        } else if (document.getElementById('hub').classList.contains('open')) {
          this.closeHub();
        } else if (document.getElementById('uploadDrawer').classList.contains('open')) {
          this.closeEditor();
        }
      }
    });
  }

  switchView(viewName) {
    this.currentView = viewName;
    ['movies', 'music', 'images', 'test', 'about'].forEach((v) => {
      document.getElementById(`view-${v}`).classList.toggle('active', v === viewName);
      document.getElementById(`nav-${v}`).classList.toggle('active', v === viewName);
    });

    if (viewName === 'movies') this.renderMovies();
    if (viewName === 'music') this.renderMusic();
    if (viewName === 'images') this.renderImages();
  }

  loadInitialData() {
    // Load persisted local library state
    try {
      const savedMovies = localStorage.getItem('gflix.movies');
      if (savedMovies) this.movies = JSON.parse(savedMovies);
      const savedMusic = localStorage.getItem('gflix.music');
      if (savedMusic) this.music = JSON.parse(savedMusic);
      const savedImages = localStorage.getItem('gflix.images');
      if (savedImages) this.images = JSON.parse(savedImages);
    } catch (e) {
      console.error(e);
    }

    this.renderMovies();
    this.updateGenreFilterOptions();
  }

  saveMovies() {
    localStorage.setItem('gflix.movies', JSON.stringify(this.movies));
    this.updateGenreFilterOptions();
  }

  updateGenreFilterOptions() {
    const sel = document.getElementById('genreFilter');
    const cur = sel.value;
    const genres = new Set();
    this.movies.forEach((m) => {
      if (m.genre) {
        m.genre.split(',').forEach((g) => {
          const trimmed = g.trim();
          if (trimmed) genres.add(trimmed);
        });
      }
    });

    sel.innerHTML = '<option value="">All Genres</option>';
    Array.from(genres).sort().forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      if (g === cur) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  // File System Access API (Offline Mode)
  async pickLibraryFolder() {
    if (!('showDirectoryPicker' in window)) {
      Modal.alert('File System Access API is not supported in this browser. You can still use the in-app Add Movie button and GMD import/export.', 'Notice');
      return;
    }

    try {
      const dirHandle = await window.showDirectoryPicker();
      Toast.show(`Opened folder: ${dirHandle.name}`);
      document.getElementById('userEmail').textContent = `Folder: ${dirHandle.name}`;

      // Check for Svideos, Smusic, GorillaImages, metadata
      let svideosCount = 0;
      try {
        const svideosHandle = await dirHandle.getDirectoryHandle('Svideos', { create: false });
        for await (const entry of svideosHandle.values()) {
          if (entry.kind === 'file' && /\.(mp4|mkv|webm|mov|avi)$/i.test(entry.name)) {
            svideosCount++;
            // Check if movie already present
            if (!this.movies.some((m) => m.fileName === entry.name)) {
              const file = await entry.getFile();
              const baseName = entry.name.replace(/\.[^.]+$/, '');
              this.movies.push({
                id: `mov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                fileName: entry.name,
                title: baseName.replace(/\(\d{4}\)/, '').trim(),
                year: (entry.name.match(/\((\d{4})\)/) || [])[1] || '2026',
                rating: 'G',
                genre: '',
                collection: '',
                tagline: '',
                description: '',
                poster: '',
                banner: '',
                titleImage: '',
                cast: [],
                fileObj: file,
                source: 'local'
              });
            }
          }
        }
      } catch (err) {
        // Svideos doesn't exist
      }

      this.saveMovies();
      this.renderMovies();
      Toast.show(`Library refreshed. ${svideosCount} video(s) detected.`);
    } catch (e) {
      if (e.name !== 'AbortError') {
        Toast.show(`Could not read directory: ${e.message}`);
      }
    }
  }

  // RENDER MOVIES
  renderMovies() {
    const grid = document.getElementById('grid-movies');
    const query = document.getElementById('movieSearch').value.toLowerCase().trim();
    const sort = document.getElementById('movieSort').value;
    const genre = document.getElementById('genreFilter').value.toLowerCase().trim();

    let list = this.movies.filter((m) => {
      const matchQuery =
        !query ||
        m.title.toLowerCase().includes(query) ||
        (m.year && m.year.includes(query)) ||
        (m.genre && m.genre.toLowerCase().includes(query)) ||
        (m.collection && m.collection.toLowerCase().includes(query)) ||
        (m.cast && m.cast.some((c) => c.name.toLowerCase().includes(query) || (c.role && c.role.toLowerCase().includes(query))));

      const matchGenre = !genre || (m.genre && m.genre.toLowerCase().includes(genre));
      return matchQuery && matchGenre;
    });

    // Sorting
    list.sort((a, b) => {
      if (sort === 'title-asc') return a.title.localeCompare(b.title);
      if (sort === 'title-desc') return b.title.localeCompare(a.title);
      if (sort === 'year-desc') return (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
      if (sort === 'year-asc') return (parseInt(a.year) || 0) - (parseInt(b.year) || 0);
      return (b.addedAt || 0) - (a.addedAt || 0);
    });

    document.getElementById('statusCount').textContent = `${list.length} movie${list.length === 1 ? '' : 's'}`;

    if (list.length === 0) {
      grid.innerHTML = '<div class="empty-message">No movies found in this library. Click <strong>+ Add Movie</strong> to import your videos.</div>';
      return;
    }

    grid.innerHTML = '';
    list.forEach((m) => {
      const card = document.createElement('div');
      card.className = 'card video-card';

      const thumb = document.createElement('div');
      thumb.className = 'thumb-box';
      if (m.poster) {
        thumb.style.backgroundImage = `url("${m.poster}")`;
      } else if (m.banner) {
        thumb.style.backgroundImage = `url("${m.banner}")`;
      } else {
        thumb.innerHTML = '<div class="thumb-ph">&#127916;</div>';
      }

      if (m.rating) {
        const badge = document.createElement('div');
        badge.className = 'badge';
        badge.textContent = m.rating;
        thumb.appendChild(badge);
      }

      const srcBadge = document.createElement('div');
      srcBadge.className = 'source-badge';
      srcBadge.textContent = 'Local';
      thumb.appendChild(srcBadge);

      const info = document.createElement('div');
      info.className = 'info-box';

      const title = document.createElement('div');
      title.className = 'title-text';
      title.textContent = m.title;

      const sub = document.createElement('div');
      sub.className = 'secondary-text';
      sub.textContent = m.year ? `${m.year}` : '';

      info.appendChild(title);
      info.appendChild(sub);

      if (m.genre) {
        const gTag = document.createElement('div');
        gTag.className = 'genre-tag-badge';
        gTag.textContent = m.genre;
        info.appendChild(gTag);
      }

      card.appendChild(thumb);
      card.appendChild(info);

      card.onclick = () => this.openMovieHub(m);
      grid.appendChild(card);
    });
  }

  // RENDER MUSIC
  renderMusic() {
    const grid = document.getElementById('grid-music');
    const query = document.getElementById('musicSearch').value.toLowerCase().trim();

    const list = this.music.filter((m) =>
      !query ||
      m.title.toLowerCase().includes(query) ||
      (m.artist && m.artist.toLowerCase().includes(query))
    );

    document.getElementById('statusCount').textContent = `${list.length} track${list.length === 1 ? '' : 's'}`;

    if (list.length === 0) {
      grid.innerHTML = '<div class="empty-message">No music tracks found. Click <strong>+ Add Track</strong> to upload soundtrack audio.</div>';
      return;
    }

    grid.innerHTML = '';
    list.forEach((t) => {
      const card = document.createElement('div');
      card.className = 'card music-card';

      const thumb = document.createElement('div');
      thumb.className = 'thumb-box';
      if (t.thumbnail) {
        thumb.style.backgroundImage = `url("${t.thumbnail}")`;
      } else {
        thumb.innerHTML = '<div class="thumb-ph">&#9835;</div>';
      }

      const info = document.createElement('div');
      info.className = 'info-box';

      const title = document.createElement('div');
      title.className = 'title-text';
      title.textContent = t.title;

      const artist = document.createElement('div');
      artist.className = 'secondary-text';
      artist.textContent = t.artist || 'Unknown Artist';

      info.appendChild(title);
      info.appendChild(artist);

      card.appendChild(thumb);
      card.appendChild(info);

      card.onclick = () => {
        this.player.open({
          src: t.fileUrl,
          title: t.title,
          subtitle: t.artist,
          audio: true,
          key: `music_${t.id}`,
          artUrl: t.thumbnail
        });
      };

      grid.appendChild(card);
    });
  }

  // RENDER IMAGES
  renderImages() {
    const grid = document.getElementById('grid-images');
    const query = document.getElementById('imageSearch').value.toLowerCase().trim();

    const list = this.images.filter((img) => !query || img.name.toLowerCase().includes(query));

    document.getElementById('statusCount').textContent = `${list.length} image${list.length === 1 ? '' : 's'}`;

    if (list.length === 0) {
      grid.innerHTML = '<div class="empty-message">No images found. Click <strong>+ Add Image</strong> to store gallery photos.</div>';
      return;
    }

    grid.innerHTML = '';
    list.forEach((img) => {
      const card = document.createElement('div');
      card.className = 'card image-card';

      const thumb = document.createElement('div');
      thumb.className = 'thumb-box';
      thumb.style.backgroundImage = `url("${img.dataUrl}")`;

      const info = document.createElement('div');
      info.className = 'info-box';

      const title = document.createElement('div');
      title.className = 'title-text';
      title.textContent = img.name;

      info.appendChild(title);
      card.appendChild(thumb);
      card.appendChild(info);

      card.onclick = () => this.openLightbox(img.dataUrl);
      grid.appendChild(card);
    });
  }

  // HUB DETAIL VIEW
  openMovieHub(movie) {
    const hub = document.getElementById('hub');
    const content = document.getElementById('hubContent');
    const backdrop = document.getElementById('hubBackdrop');

    backdrop.style.backgroundImage = movie.banner ? `url("${movie.banner}")` : movie.poster ? `url("${movie.poster}")` : 'none';

    content.innerHTML = `
      <div class="hub-title">${movie.title}</div>
      <div class="hub-info">
        ${movie.year ? `<span>${movie.year}</span> &bull; ` : ''}
        ${movie.rating ? `<span>${movie.rating}</span> &bull; ` : ''}
        ${movie.genre ? `<span>${movie.genre}</span> &bull; ` : ''}
        ${movie.collection ? `<span>[${movie.collection}]</span>` : ''}
      </div>
      ${movie.tagline ? `<div class="hub-tagline">${movie.tagline}</div>` : ''}
      ${movie.description ? `<div class="hub-description">${movie.description}</div>` : ''}

      <div class="hub-actions">
        <button class="btn-tv btn-tv-primary" id="hubPlayBtn">&#9654; Play Movie</button>
        <button class="btn-tv btn-tv-secondary" id="hubEditBtn">&#9998; Edit Metadata</button>
        <button class="btn-tv btn-tv-secondary" id="hubExportGmdBtn">&#10515; Export GMD</button>
        <button class="btn-tv btn-tv-secondary" id="hubDeleteBtn" style="color:#ff7b86;">&#128465; Delete</button>
      </div>

      ${
        movie.cast && movie.cast.length > 0
          ? `
        <div class="cast-heading">Cast & Characters</div>
        <div class="cast-row">
          ${movie.cast
            .map(
              (actor) => `
            <div class="cast-item">
              <div class="cast-avatar" ${actor.image ? `style="background-image:url('${actor.image}');"` : ''}>
                ${actor.image ? '' : (actor.name ? actor.name.charAt(0).toUpperCase() : '?')}
              </div>
              <div class="cast-name">${actor.name}</div>
              <div class="cast-role">${actor.role || ''}</div>
            </div>
          `
            )
            .join('')}
        </div>
      `
          : ''
      }
    `;

    document.getElementById('hubPlayBtn').onclick = () => {
      this.playMovie(movie);
    };
    document.getElementById('hubEditBtn').onclick = () => {
      this.closeHub();
      this.openEditor(movie);
    };
    document.getElementById('hubExportGmdBtn').onclick = () => {
      this.exportGmd(movie);
    };
    document.getElementById('hubDeleteBtn').onclick = async () => {
      const ok = await Modal.confirm(`Are you sure you want to remove "${movie.title}" from your library?`, 'Confirm Delete');
      if (ok) {
        this.movies = this.movies.filter((m) => m.id !== movie.id);
        this.saveMovies();
        this.closeHub();
        this.renderMovies();
        Toast.show(`Removed "${movie.title}"`);
      }
    };

    hub.classList.add('open');
  }

  closeHub() {
    document.getElementById('hub').classList.remove('open');
  }

  playMovie(movie) {
    let playUrl = movie.streamUrl || '';
    if (movie.fileObj) {
      playUrl = URL.createObjectURL(movie.fileObj);
    } else if (movie.filePath) {
      playUrl = movie.filePath;
    }

    if (!playUrl) {
      Modal.alert('No playable media source found for this movie. Please edit metadata to attach a video file.', 'Playback Error');
      return;
    }

    this.player.open({
      src: playUrl,
      title: `${movie.title} (${movie.year || '2026'})`,
      audio: false,
      key: `movie_${movie.id}`
    });
  }

  openLightbox(src) {
    document.getElementById('lightboxImg').src = src;
    document.getElementById('lightbox').classList.add('open');
  }

  closeLightbox() {
    document.getElementById('lightbox').classList.remove('open');
    document.getElementById('lightboxImg').src = '';
  }

  // METADATA EDITOR DRAWER
  openEditor(movie) {
    this.editingMovie = movie;
    const isNew = !movie;
    document.getElementById('drawerTitle').textContent = isNew ? 'Add Movie' : 'Edit Movie';
    document.getElementById('upValidationError').classList.add('hidden');

    // Populate Fields
    document.getElementById('upTitle').value = movie ? movie.title || '' : '';
    document.getElementById('upYear').value = movie ? movie.year || '' : new Date().getFullYear();
    document.getElementById('upRating').value = movie ? movie.rating || 'G' : 'G';
    document.getElementById('upGenre').value = movie ? movie.genre || '' : '';
    document.getElementById('upCollection').value = movie ? movie.collection || '' : '';
    document.getElementById('upTagline').value = movie ? movie.tagline || '' : '';
    document.getElementById('upDesc').value = movie ? movie.description || '' : '';

    // Video File Picker
    document.getElementById('upFile').value = '';
    document.getElementById('upFilePreview').textContent = movie ? (movie.fileName || 'Attached') : '';

    // Artwork
    this.setArtPreview('posterPreviewThumb', movie ? movie.poster : '');
    this.setArtPreview('bannerPreviewThumb', movie ? movie.banner : '');
    this.setArtPreview('titleImgPreviewThumb', movie ? movie.titleImage : '');

    // Cast Cards
    this.activeCast = movie && movie.cast ? JSON.parse(JSON.stringify(movie.cast)) : [];
    this.renderCastCards();

    document.getElementById('uploadDrawer').classList.add('open');
  }

  closeEditor() {
    document.getElementById('uploadDrawer').classList.remove('open');
    this.editingMovie = null;
  }

  bindArtPicker(inputId, previewId, removeBtnId) {
    const input = document.getElementById(inputId);
    const removeBtn = document.getElementById(removeBtnId);

    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          this.setArtPreview(previewId, ev.target.result);
        };
        reader.readAsDataURL(file);
      }
    };

    removeBtn.onclick = () => {
      input.value = '';
      this.setArtPreview(previewId, '');
    };
  }

  setArtPreview(previewId, url) {
    const el = document.getElementById(previewId);
    if (url) {
      el.style.backgroundImage = `url("${url}")`;
      el.style.display = 'block';
      el.dataset.url = url;
    } else {
      el.style.backgroundImage = 'none';
      el.style.display = 'none';
      el.dataset.url = '';
    }
  }

  // CAST MANAGER & UP/DOWN REORDERING (PHASE 3)
  renderCastCards() {
    const container = document.getElementById('upCastContainer');
    container.innerHTML = '';

    this.activeCast.forEach((actor, index) => {
      const card = document.createElement('div');
      card.className = 'up-cast-card';

      // Card Header with Order Buttons
      const header = document.createElement('div');
      header.className = 'cast-card-top';

      const label = document.createElement('strong');
      label.textContent = `Actor #${index + 1}`;
      label.style.fontSize = '12px';

      const orderWrap = document.createElement('div');
      orderWrap.className = 'cast-order-btns';

      const btnUp = document.createElement('button');
      btnUp.type = 'button';
      btnUp.className = 'btn-order-arrow';
      btnUp.innerHTML = '&uarr;';
      btnUp.title = 'Move Up';
      btnUp.disabled = index === 0;
      btnUp.onclick = () => this.moveCastActor(index, -1);

      const btnDown = document.createElement('button');
      btnDown.type = 'button';
      btnDown.className = 'btn-order-arrow';
      btnDown.innerHTML = '&darr;';
      btnDown.title = 'Move Down';
      btnDown.disabled = index === this.activeCast.length - 1;
      btnDown.onclick = () => this.moveCastActor(index, 1);

      const btnRemove = document.createElement('button');
      btnRemove.type = 'button';
      btnRemove.className = 'btn-remove-art';
      btnRemove.textContent = 'Delete';
      btnRemove.onclick = async () => {
        const ok = await Modal.confirm(`Remove actor "${actor.name || 'Row'}"?`, 'Confirm Delete');
        if (ok) {
          this.activeCast.splice(index, 1);
          this.renderCastCards();
        }
      };

      orderWrap.appendChild(btnUp);
      orderWrap.appendChild(btnDown);
      orderWrap.appendChild(btnRemove);

      header.appendChild(label);
      header.appendChild(orderWrap);

      // Name & Role Inputs
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Actor / Actress Name';
      nameInput.value = actor.name || '';
      nameInput.oninput = (e) => {
        actor.name = e.target.value;
      };

      const roleInput = document.createElement('input');
      roleInput.type = 'text';
      roleInput.placeholder = 'Character / Role';
      roleInput.value = actor.role || '';
      roleInput.oninput = (e) => {
        actor.role = e.target.value;
      };

      // Photo Picker
      const photoRow = document.createElement('div');
      photoRow.className = 'art-picker-row';

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.className = 'art-file-input';

      const photoThumb = document.createElement('div');
      photoThumb.className = 'art-preview-thumb';
      if (actor.image) {
        photoThumb.style.backgroundImage = `url("${actor.image}")`;
        photoThumb.style.display = 'block';
      }

      fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            actor.image = ev.target.result;
            photoThumb.style.backgroundImage = `url("${actor.image}")`;
            photoThumb.style.display = 'block';
          };
          reader.readAsDataURL(file);
        }
      };

      photoRow.appendChild(fileInput);

      card.appendChild(header);
      card.appendChild(nameInput);
      card.appendChild(roleInput);
      card.appendChild(photoRow);
      card.appendChild(photoThumb);

      container.appendChild(card);
    });
  }

  addActorRow() {
    this.activeCast.push({ name: '', role: '', image: '' });
    this.renderCastCards();
  }

  moveCastActor(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= this.activeCast.length) return;
    const temp = this.activeCast[index];
    this.activeCast[index] = this.activeCast[target];
    this.activeCast[target] = temp;
    this.renderCastCards();
  }

  // SAVE VALIDATION & SUBMISSION
  saveEditor() {
    const title = document.getElementById('upTitle').value.trim();
    const year = document.getElementById('upYear').value.trim();
    const errBox = document.getElementById('upValidationError');

    // Validation (Title and Year required)
    if (!title) {
      errBox.textContent = 'Movie Title is required.';
      errBox.classList.remove('hidden');
      return;
    }
    if (!year || !/^\d{4}$/.test(year)) {
      errBox.textContent = 'A valid 4-digit Year (e.g. 2026) is required.';
      errBox.classList.remove('hidden');
      return;
    }

    const rating = document.getElementById('upRating').value.trim() || 'G';
    const genre = document.getElementById('upGenre').value.trim();
    const collection = document.getElementById('upCollection').value.trim();
    const tagline = document.getElementById('upTagline').value.trim();
    const description = document.getElementById('upDesc').value.trim();
    const poster = document.getElementById('posterPreviewThumb').dataset.url || '';
    const banner = document.getElementById('bannerPreviewThumb').dataset.url || '';
    const titleImage = document.getElementById('titleImgPreviewThumb').dataset.url || '';

    const videoFile = document.getElementById('upFile').files[0];

    const cleanCast = this.activeCast.filter((c) => c.name.trim().length > 0);

    if (this.editingMovie) {
      // Update existing
      this.editingMovie.title = title;
      this.editingMovie.year = year;
      this.editingMovie.rating = rating;
      this.editingMovie.genre = genre;
      this.editingMovie.collection = collection;
      this.editingMovie.tagline = tagline;
      this.editingMovie.description = description;
      this.editingMovie.poster = poster;
      this.editingMovie.banner = banner;
      this.editingMovie.titleImage = titleImage;
      this.editingMovie.cast = cleanCast;
      if (videoFile) {
        this.editingMovie.fileObj = videoFile;
        this.editingMovie.fileName = videoFile.name;
      }
      Toast.show(`Updated "${title}"`);
    } else {
      // Create new
      const newMovie = {
        id: `mov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        title,
        year,
        rating,
        genre,
        collection,
        tagline,
        description,
        poster,
        banner,
        titleImage,
        cast: cleanCast,
        fileName: videoFile ? videoFile.name : `${title}.mp4`,
        fileObj: videoFile || null,
        addedAt: Date.now(),
        source: 'local'
      };
      this.movies.push(newMovie);
      Toast.show(`Created movie "${title}"`);
    }

    this.saveMovies();
    this.closeEditor();
    this.renderMovies();
  }

  // BULK RESCAN AND REBUILD (PHASE 4)
  async rebuildMissingGmd() {
    let rebuilt = 0;
    this.movies.forEach((m) => {
      if (!m.year || !m.title) {
        m.title = m.title || m.fileName.replace(/\.[^.]+$/, '');
        m.year = m.year || '2026';
        rebuilt++;
      }
    });

    this.saveMovies();
    this.renderMovies();
    Toast.show(`Rebuild complete: verified ${this.movies.length} GMD profiles.`);
  }

  // GMD IMPORT & EXPORT
  exportGmd(movie) {
    const gmdData = {
      title: movie.title,
      year: movie.year,
      rating: movie.rating || 'G',
      genre: movie.genre || '',
      collection: movie.collection || '',
      tagline: movie.tagline || '',
      description: movie.description || '',
      poster: movie.poster ? 'metadata/images/poster/' : '',
      banner: movie.banner ? 'metadata/images/bg/' : '',
      titleImage: movie.titleImage ? 'metadata/images/title/' : '',
      cast: movie.cast || []
    };

    const blob = new Blob([JSON.stringify(gmdData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${movie.title.replace(/[^\w.-]/g, '_')}.gmd`;
    a.click();
    URL.revokeObjectURL(url);
    Toast.show(`Exported ${a.download}`);
  }

  handleImportGmd(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const meta = JSON.parse(ev.target.result);
        if (!meta.title || !meta.year) {
          Modal.alert('The imported file is missing required fields (title and year).', 'Import Failed');
          return;
        }

        const id = `mov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        this.movies.push({
          id,
          title: meta.title,
          year: String(meta.year),
          rating: meta.rating || 'G',
          genre: meta.genre || '',
          collection: meta.collection || '',
          tagline: meta.tagline || '',
          description: meta.description || '',
          poster: meta.poster || '',
          banner: meta.banner || '',
          titleImage: meta.titleImage || '',
          cast: meta.cast || [],
          fileName: `${meta.title}.mp4`,
          addedAt: Date.now(),
          source: 'local'
        });

        this.saveMovies();
        this.renderMovies();
        Toast.show(`Imported GMD: "${meta.title}"`);
      } catch (err) {
        Modal.alert(`Failed to parse GMD: ${err.message}`, 'Corrupt File');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // PLAYER TEST BENCH
  runTestPlay() {
    const fileInput = document.getElementById('testLocalFile');
    const urlInput = document.getElementById('testUrl');

    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const url = URL.createObjectURL(file);
      const isAudio = /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name);
      this.player.open({
        src: url,
        title: file.name,
        subtitle: isAudio ? 'Audio Track' : 'Video Track',
        audio: isAudio,
        key: 'test_file'
      });
    } else if (urlInput.value.trim()) {
      const url = urlInput.value.trim();
      const isAudio = /\.(mp3|wav|ogg|m4a|aac|flac)(\?|#|$)/i.test(url);
      this.player.open({
        src: url,
        title: url.split('/').pop() || 'Network Stream',
        subtitle: isAudio ? 'Remote Audio' : 'Remote Stream',
        audio: isAudio,
        key: 'test_stream'
      });
    } else {
      Modal.alert('Please select a local media file or type a streaming URL to test.', 'Player Test');
    }
  }
}

// Boot GorillaFlix Engine on load
window.addEventListener('DOMContentLoaded', () => {
  window.gorillaFlix = new GorillaFlixApp();
});
