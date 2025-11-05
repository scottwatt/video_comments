class VideoCommentInjector {
  constructor() {
    this.platform = this.detectPlatform();
    this.videoElement = null;
    this.currentVideoId = null;
    this.comments = [];
    this.overlayContainer = null;
    this.contentFilter = new ContentFilter();
    this.realtimeInterval = null;
    this.videoIdFinalized = false;
    
    this.init();
  }

  detectPlatform() {
    const hostname = window.location.hostname;
    if (hostname.includes('netflix')) return 'netflix';
    if (hostname.includes('disneyplus')) return 'disneyplus';
    if (hostname.includes('hulu')) return 'hulu';
    return null;
  }

  init() {
    console.log(`TimelineComments: Initializing on ${this.platform}`);
    
    // Wait for video element to load
    this.waitForVideo();
    
    // Watch for navigation/URL changes (Netflix is a SPA)
    this.watchForNavigation();
  }

  watchForNavigation() {
    // Netflix is a SPA - watch for URL changes
    let lastUrl = window.location.href;
    
    const checkUrlChange = () => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        console.log('TimelineComments: URL changed from', lastUrl, 'to', currentUrl);
        lastUrl = currentUrl;
        
        // Reset video ID state
        this.videoIdFinalized = false;
        this.currentVideoId = null;
        
        // Clear old comments
        this.comments = [];
        
        // Stop old polling
        if (this.realtimeInterval) {
          clearInterval(this.realtimeInterval);
          this.realtimeInterval = null;
        }
        
        // Re-extract video info when video loads
        this.extractVideoInfoWhenReady();
        
        // Re-render empty state while loading
        this.renderCommentsList();
      }
    };
    
    // Check every 1 second for URL changes
    setInterval(checkUrlChange, 1000);
    
    // Also listen to popstate (browser back/forward)
    window.addEventListener('popstate', checkUrlChange);
  }

  waitForVideo() {
    const observer = new MutationObserver(() => {
      this.videoElement = this.findVideoElement();
      
      if (this.videoElement) {
        console.log('TimelineComments: Video element found!');
        observer.disconnect();
        this.setupVideoListeners();
        this.injectOverlay();
        
        // Extract video info now that we have the video element
        if (!this.videoIdFinalized) {
          this.extractVideoInfoWhenReady();
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also check immediately
    this.videoElement = this.findVideoElement();
    if (this.videoElement) {
      this.setupVideoListeners();
      this.injectOverlay();
      
      // Extract video info
      if (!this.videoIdFinalized) {
        this.extractVideoInfoWhenReady();
      }
    }
  }

  findVideoElement() {
    // Each platform has different video element selectors
    const selectors = {
      netflix: 'video',
      disneyplus: 'video',
      hulu: 'video'
    };
    
    const videos = document.querySelectorAll(selectors[this.platform]);
    
    // Netflix might have multiple video elements, get the active one
    if (videos.length > 1) {
      // Find the one that's actually playing
      for (let video of videos) {
        if (video.readyState > 0 && !video.paused) {
          return video;
        }
      }
      // If none playing, get the first one with content
      for (let video of videos) {
        if (video.readyState > 0) {
          return video;
        }
      }
    }
    
    return videos[0] || null;
  }

getRealTimestamp() {
    try {
      if (this.platform === 'disneyplus') {
        console.log('=== DISNEY+ TIMESTAMP DETECTION ===');
        
        // Find the progress-bar custom element
        const progressBar = document.querySelector('progress-bar');
        
        if (progressBar) {
          console.log('TimelineComments: Progress bar element found:', progressBar);
          
          // Try to access shadow DOM
          try {
            if (progressBar.shadowRoot) {
              console.log('TimelineComments: Shadow DOM found!');
              
              const shadowInput = progressBar.shadowRoot.querySelector('input[type="range"]') ||
                                 progressBar.shadowRoot.querySelector('[role="slider"]');
              
              if (shadowInput) {
                const value = parseFloat(shadowInput.value);
                const max = parseFloat(shadowInput.max);
                console.log('TimelineComments: Shadow DOM slider - value:', value, 'max:', max);
                
                if (max > 100 && max < 86400 && value > 0) {
                  console.log('TimelineComments: Using shadow DOM slider value:', value);
                  return Math.floor(value);
                }
              }
            }
          } catch (e) {
            console.log('TimelineComments: Error accessing shadow DOM:', e);
          }
          
          // Try to access element properties directly
          try {
            console.log('TimelineComments: Checking progress-bar properties...');
            
            const possibleProps = [
              'value', 'currentTime', 'current', 'position',
              'currentValue', 'time', 'playbackTime', 'seconds'
            ];
            
            for (const prop of possibleProps) {
              try {
                if (progressBar[prop] !== undefined && progressBar[prop] !== null) {
                  const value = parseFloat(progressBar[prop]);
                  console.log(`TimelineComments: Found property ${prop}:`, value);
                  
                  if (!isNaN(value) && value > 0 && value < 86400) {
                    console.log('TimelineComments: Using property', prop, '=', value);
                    return Math.floor(value);
                  }
                }
              } catch (propError) {
                // Skip this property
              }
            }
          } catch (e) {
            console.log('TimelineComments: Error checking properties:', e);
          }
          
          // Try accessing via getAttribute
          try {
            const dataAttrs = progressBar.getAttributeNames();
            console.log('TimelineComments: Progress bar attributes:', dataAttrs);
            
            for (const attr of dataAttrs) {
              const value = progressBar.getAttribute(attr);
              if (value && value.match(/^\d+(\.\d+)?$/)) {
                const numValue = parseFloat(value);
                if (!isNaN(numValue) && numValue > 10 && numValue < 86400) {
                  console.log(`TimelineComments: Using attribute ${attr} =`, numValue);
                  return Math.floor(numValue);
                }
              }
            }
          } catch (e) {
            console.log('TimelineComments: Error checking attributes:', e);
          }
        }
        
        // Method 2: Look for time displays in the controls area
        try {
          const controlsArea = document.querySelector('.controls');
          if (controlsArea) {
            const timeElements = controlsArea.querySelectorAll('*');
            const timeTexts = [];
            
            for (const el of timeElements) {
              const text = (el.textContent || '').trim();
              if (text.length < 30 && text.match(/\d{1,2}:\d{2}/)) {
                timeTexts.push(text);
              }
            }
            
            console.log('TimelineComments: Time texts found in controls:', timeTexts);
            
            // Parse all times and pick the largest
            const times = [];
            for (const text of timeTexts) {
              const match = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
              if (match) {
                const hours = match[3] ? parseInt(match[1]) : 0;
                const minutes = match[3] ? parseInt(match[2]) : parseInt(match[1]);
                const seconds = match[3] ? parseInt(match[3]) : parseInt(match[2]);
                const totalSeconds = hours * 3600 + minutes * 60 + seconds;
                
                if (totalSeconds > 0 && totalSeconds < 86400) {
                  times.push(totalSeconds);
                }
              }
            }
            
            if (times.length > 0) {
              const maxTime = Math.max(...times);
              console.log('TimelineComments: Using largest time from controls:', maxTime);
              return maxTime;
            }
          }
        } catch (e) {
          console.log('TimelineComments: Error parsing control times:', e);
        }
      }
      
      // Netflix
      if (this.platform === 'netflix') {
        try {
          const timeDisplay = document.querySelector('.watch-video--player-view .watch-video--progress-control-row .time-remaining');
          if (timeDisplay) {
            const text = timeDisplay.textContent;
            const match = text.match(/(\d{1,2}):(\d{2}):(\d{2})/);
            if (match) {
              const hours = parseInt(match[1]);
              const minutes = parseInt(match[2]);
              const seconds = parseInt(match[3]);
              return hours * 3600 + minutes * 60 + seconds;
            }
          }
        } catch (e) {
          console.log('TimelineComments: Error getting Netflix time:', e);
        }
      }
      
      // Hulu
      if (this.platform === 'hulu') {
        try {
          const timeDisplay = document.querySelector('.ControlsContainer__time-display');
          if (timeDisplay) {
            const text = timeDisplay.textContent;
            const match = text.match(/(\d{1,2}):(\d{2})/);
            if (match) {
              const minutes = parseInt(match[1]);
              const seconds = parseInt(match[2]);
              return minutes * 60 + seconds;
            }
          }
        } catch (e) {
          console.log('TimelineComments: Error getting Hulu time:', e);
        }
      }
      
      // Fallback
      this.videoElement = this.findVideoElement();
      if (this.videoElement && this.videoElement.currentTime > 0) {
        console.warn('TimelineComments: Using video element currentTime as fallback (may be inaccurate)');
        return Math.floor(this.videoElement.currentTime);
      }
      
    } catch (e) {
      console.error('TimelineComments: Error in getRealTimestamp:', e);
    }
    
    return null;
  }

  async extractVideoInfoWhenReady() {
    // Try immediately
    this.extractVideoInfo();
    
    // If we got a valid ID, we're done
    if (this.currentVideoId && !this.currentVideoId.includes('null') && !this.currentVideoId.includes('undefined')) {
      this.videoIdFinalized = true;
      await this.loadComments();
      return;
    }
    
    // Otherwise, wait for video to start loading and try again
    console.log('TimelineComments: Waiting for video metadata...');
    
    let attempts = 0;
    const maxAttempts = 10;
    
    const checkInterval = setInterval(async () => {
      attempts++;
      
      // Refresh video element reference
      this.videoElement = this.findVideoElement();
      
      // Try extraction again
      this.extractVideoInfo();
      
      // Check if we got a valid ID
      if (this.currentVideoId && !this.currentVideoId.includes('null') && !this.currentVideoId.includes('undefined')) {
        this.videoIdFinalized = true;
        clearInterval(checkInterval);
        console.log('TimelineComments: Video ID finalized!');
        await this.loadComments();
      } else if (attempts >= maxAttempts) {
        // Give up after max attempts
        clearInterval(checkInterval);
        console.log('TimelineComments: Could not determine video ID after', maxAttempts, 'attempts');
        
        // Use whatever we have as fallback
        if (this.currentVideoId) {
          this.videoIdFinalized = true;
          await this.loadComments();
        }
      }
    }, 500);
  }

  extractVideoInfo() {
    // Extract what's playing from URL and page metadata
    const url = window.location.href;
    console.log('TimelineComments: Extracting from URL:', url);
    
    if (this.platform === 'netflix') {
      // Netflix URL: /watch/81234567 (show/movie ID)
      const match = url.match(/\/watch\/(\d+)/);
      const showId = match ? match[1] : null;
      
      if (!showId) {
        this.currentVideoId = null;
        console.log('TimelineComments: No show ID found in URL');
        return;
      }
      
      // Try to get episode metadata from multiple sources
      const episodeId = this.getNetflixEpisodeId();
      
      if (episodeId && episodeId !== showId) {
        // We found a specific episode ID different from the show ID
        this.currentVideoId = `netflix_ep_${episodeId}`;
        console.log('TimelineComments: Using episode ID:', episodeId);
      } else {
        // Use show ID as fallback (might be a movie or we couldn't get episode ID yet)
        this.currentVideoId = `netflix_${showId}`;
        console.log('TimelineComments: Using show ID:', showId);
      }
      
    } else if (this.platform === 'disneyplus') {
      // Disney+ URL: /video/[guid] or /play/[guid]
      const videoMatch = url.match(/\/video\/([^?]+)/);
      const playMatch = url.match(/\/play\/([^?]+)/);
      const guid = videoMatch ? videoMatch[1] : (playMatch ? playMatch[1] : null);
      this.currentVideoId = guid ? `disneyplus_${guid}` : null;
      
    } else if (this.platform === 'hulu') {
      // Hulu URL: /watch/[id]
      const match = url.match(/\/watch\/([^?]+)/);
      this.currentVideoId = match ? `hulu_${match[1]}` : null;
    }

    console.log(`TimelineComments: Video ID = ${this.currentVideoId}`);
  }

  getNetflixEpisodeId() {
    // Method 1: Check video element source URL (most reliable when available)
    if (this.videoElement) {
      const videoSrc = this.videoElement.currentSrc || this.videoElement.src;
      if (videoSrc) {
        // Netflix video URLs contain the actual video ID
        // Format: https://.../?o=...&v=...&movieid=XXXXX...
        const movieIdMatch = videoSrc.match(/[?&]movieid=(\d+)/);
        if (movieIdMatch) {
          console.log('TimelineComments: Found episode ID in video source (movieid):', movieIdMatch[1]);
          return movieIdMatch[1];
        }
        
        // Alternative format: /.../{showId}/{episodeId}?...
        const pathMatch = videoSrc.match(/\/(\d+)\/(\d+)\?/);
        if (pathMatch && pathMatch[2]) {
          console.log('TimelineComments: Found episode ID in video source (path):', pathMatch[2]);
          return pathMatch[2];
        }
      }
    }
    
    // Method 2: Parse from URL tctx parameter (look for actual episode identifiers)
    const urlParams = new URLSearchParams(window.location.search);
    const tctx = urlParams.get('tctx');
    if (tctx) {
      // The tctx parameter contains video ID like "Video:70143825" or "Video%3A70143825"
      const videoMatch = tctx.match(/Video[:%](\d+)/);
      if (videoMatch) {
        console.log('TimelineComments: Found episode ID in tctx:', videoMatch[1]);
        return videoMatch[1];
      }
    }
    
    // Method 3: Check Netflix's page metadata
    try {
      if (window.netflix && window.netflix.reactContext) {
        const models = window.netflix.reactContext.models;
        if (models && models.playerModel && models.playerModel.videoId) {
          const videoId = models.playerModel.videoId;
          console.log('TimelineComments: Found episode ID in player model:', videoId);
          return videoId;
        }
      }
    } catch (e) {
      // Ignore
    }
    
    // Method 4: Check for episode metadata in page elements
    try {
      const playerContainer = document.querySelector('[data-videoid]');
      if (playerContainer) {
        const videoId = playerContainer.getAttribute('data-videoid');
        if (videoId) {
          console.log('TimelineComments: Found episode ID in player container:', videoId);
          return videoId;
        }
      }
    } catch (e) {
      // Ignore
    }
    
    // If we can't find an episode ID, return null
    console.log('TimelineComments: Could not determine episode ID yet');
    return null;
  }

  setupVideoListeners() {
    if (!this.videoElement) return;

    // Listen to time updates
    this.videoElement.addEventListener('timeupdate', () => {
      this.onTimeUpdate();
    });

    // Listen to play/pause
    this.videoElement.addEventListener('play', () => {
      console.log('TimelineComments: Video playing');
      
      // When video starts playing, try to finalize video ID if not done yet
      if (!this.videoIdFinalized) {
        this.extractVideoInfoWhenReady();
      }
    });

    this.videoElement.addEventListener('pause', () => {
      console.log('TimelineComments: Video paused');
    });
    
    // Listen for when video metadata is loaded
    this.videoElement.addEventListener('loadedmetadata', () => {
      console.log('TimelineComments: Video metadata loaded');
      
      // Try to finalize video ID now that we have metadata
      if (!this.videoIdFinalized) {
        this.extractVideoInfoWhenReady();
      }
    });
  }

  onTimeUpdate() {
    // Refresh video element reference to ensure we have the active one
    const video = this.findVideoElement();
    if (!video) return;
    
    const currentTime = Math.floor(video.currentTime);
    
    // Check if there are comments at this timestamp
    const activeComments = this.comments.filter(c => 
      Math.abs(c.timestamp - currentTime) < 1
    );

    if (activeComments.length > 0) {
      this.displayComments(activeComments);
    }
  }

  async loadComments() {
    try {
      console.log('TimelineComments: Loading comments for', this.currentVideoId);
      
      // Load comments from Firebase via background script
      const response = await chrome.runtime.sendMessage({
        type: 'LOAD_COMMENTS',
        videoId: this.currentVideoId
      });
      
      if (response && response.success) {
        this.comments = response.comments;
        console.log(`TimelineComments: Loaded ${this.comments.length} comments from Firebase for ${this.currentVideoId}`);
        this.renderCommentsList();
        
        // Set up real-time listener for new comments
        this.setupRealtimeListener();
      }
    } catch (error) {
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.log('TimelineComments: Extension reloaded - please refresh the page');
        this.showExtensionReloadedNotice();
      } else {
        console.error('TimelineComments: Error loading comments', error);
      }
      this.comments = [];
    }
  }
  
  setupRealtimeListener() {
    // Clear any existing interval first
    if (this.realtimeInterval) {
      clearInterval(this.realtimeInterval);
    }
    
    // Listen for real-time updates from Firebase
    // Poll every 10 seconds for new comments
    this.realtimeInterval = setInterval(async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'LOAD_COMMENTS',
          videoId: this.currentVideoId
        });
        
        if (response && response.success && response.comments.length !== this.comments.length) {
          this.comments = response.comments;
          this.renderCommentsList();
        }
      } catch (error) {
        // Extension was reloaded - stop polling and notify user
        if (error.message && error.message.includes('Extension context invalidated')) {
          console.log('TimelineComments: Extension reloaded - please refresh the page');
          clearInterval(this.realtimeInterval);
          this.showExtensionReloadedNotice();
        } else {
          console.error('TimelineComments: Error checking for updates', error);
        }
      }
    }, 10000);
  }

  showExtensionReloadedNotice() {
    // Show notice in comment panel that extension was reloaded
    const panel = document.getElementById('tc-comment-panel');
    if (!panel) return;
    
    // Check if notice already exists
    if (panel.querySelector('.tc-reload-notice')) return;
    
    const notice = document.createElement('div');
    notice.className = 'tc-reload-notice';
    notice.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(239, 68, 68, 0.95);
      color: white;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      z-index: 1000;
      max-width: 80%;
    `;
    notice.innerHTML = `
      <div style="font-size: 16px; font-weight: 600; margin-bottom: 10px;">
        Extension Updated
      </div>
      <div style="font-size: 14px; margin-bottom: 15px;">
        Please refresh this page to continue using TimelineComments
      </div>
      <button style="
        background: white;
        color: #ef4444;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 600;
      " onclick="location.reload()">
        Refresh Now
      </button>
    `;
    
    panel.appendChild(notice);
  }

  async saveComment(text, timestamp) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_COMMENT',
        data: {
          videoId: this.currentVideoId,
          text,
          timestamp,
          platform: this.platform
        }
      });
      
      if (response && response.success) {
        // Comment saved to Firebase and returned
        this.comments.push(response.comment);
        this.comments.sort((a, b) => a.timestamp - b.timestamp);
        return response.comment;
      } else {
        throw new Error(response.error || 'Failed to save comment');
      }
    } catch (error) {
      console.error('TimelineComments: Error saving comment', error);
      throw error;
    }
  }

  injectOverlay() {
    // Check if overlay already exists
    if (document.getElementById('timeline-comments-overlay')) {
      console.log('TimelineComments: Overlay already exists');
      return;
    }
    
    // Create the overlay UI
    this.overlayContainer = document.createElement('div');
    this.overlayContainer.id = 'timeline-comments-overlay';
    this.overlayContainer.innerHTML = `
      <div id="tc-comment-panel">
        <div id="tc-header">
          <h3>💬 TimelineComments</h3>
          <button id="tc-close">×</button>
        </div>
        <div id="tc-comments-list"></div>
        <div id="tc-add-comment">
          <div class="tc-input-wrapper">
            <input type="text" id="tc-comment-input" placeholder="Add comment at current time..." />
            <button id="tc-submit">Pin</button>
          </div>
        </div>
      </div>
      <button id="tc-toggle">💬</button>
    `;

    document.body.appendChild(this.overlayContainer);

    // Setup event listeners
    this.setupOverlayListeners();
    
    // Render existing comments
    this.renderCommentsList();
  }

  setupOverlayListeners() {
    const toggle = document.getElementById('tc-toggle');
    const panel = document.getElementById('tc-comment-panel');
    const close = document.getElementById('tc-close');
    const submit = document.getElementById('tc-submit');
    const input = document.getElementById('tc-comment-input');

    toggle.addEventListener('click', () => {
      panel.classList.toggle('visible');
    });

    close.addEventListener('click', () => {
      panel.classList.remove('visible');
    });

    submit.addEventListener('click', () => {
      this.handleAddComment(input.value);
    });

    // Prevent ALL keyboard events from bubbling up to video player
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
    });

    input.addEventListener('keyup', (e) => {
      e.stopPropagation();
    });

    input.addEventListener('keypress', (e) => {
      e.stopPropagation();
      
      if (e.key === 'Enter') {
        this.handleAddComment(input.value);
      }
    });

    // Also prevent focus/blur issues
    input.addEventListener('focus', (e) => {
      e.stopPropagation();
    });

    input.addEventListener('blur', (e) => {
      e.stopPropagation();
    });

    // Prevent mouse events from affecting video
    panel.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    panel.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    panel.addEventListener('mouseup', (e) => {
      e.stopPropagation();
    });
  }

  async handleAddComment(text) {
    if (!text.trim()) return;
    
    // Filter content before sending
    const filterResult = this.contentFilter.filterContent(text);
    
    if (!filterResult.isClean) {
      this.showError(filterResult.violations.join('. '));
      return;
    }

    // Get the REAL timestamp from the platform's player
    const timestamp = this.getRealTimestamp();
    
    if (timestamp === null) {
      this.showError('Could not get current timestamp. Please try again.');
      return;
    }
    
    // Debug logging
    console.log('TimelineComments: Real timestamp:', timestamp);
    console.log('TimelineComments: Formatted time:', this.formatTime(timestamp));
    
    try {
      await this.saveComment(text, timestamp);
      
      // Clear input
      document.getElementById('tc-comment-input').value = '';
      
      // Re-render list
      this.renderCommentsList();
      
      // Show success message with timestamp
      this.showSuccess(`Comment pinned at ${this.formatTime(timestamp)}`);
    } catch (error) {
      this.showError('Failed to save comment. Please try again.');
    }
  }
  
  showError(message) {
    const addCommentSection = document.getElementById('tc-add-comment');
    if (!addCommentSection) return;
    
    // Remove any existing error messages
    const existingError = addCommentSection.querySelector('.tc-error-message');
    if (existingError) {
      existingError.remove();
    }
    
    // Create error message element
    const errorDiv = document.createElement('div');
    errorDiv.className = 'tc-error-message';
    errorDiv.textContent = message;
    
    // Insert at the top of add comment section
    addCommentSection.insertBefore(errorDiv, addCommentSection.firstChild);
    
    // Remove after 4 seconds
    setTimeout(() => {
      errorDiv.remove();
    }, 4000);
  }

  showSuccess(message) {
    const addCommentSection = document.getElementById('tc-add-comment');
    if (!addCommentSection) return;
    
    // Remove any existing success messages
    const existingSuccess = addCommentSection.querySelector('.tc-success-message');
    if (existingSuccess) {
      existingSuccess.remove();
    }
    
    // Create success message element
    const successDiv = document.createElement('div');
    successDiv.className = 'tc-success-message';
    successDiv.textContent = message;
    
    // Insert at the top of add comment section
    addCommentSection.insertBefore(successDiv, addCommentSection.firstChild);
    
    // Remove after 3 seconds
    setTimeout(() => {
      successDiv.remove();
    }, 3000);
  }

  renderCommentsList() {
    const list = document.getElementById('tc-comments-list');
    if (!list) return;

    if (this.comments.length === 0) {
      list.innerHTML = '<p class="tc-empty">No comments yet. Be the first!</p>';
      return;
    }

    list.innerHTML = this.comments.map(c => `
      <div class="tc-comment" data-timestamp="${c.timestamp}" data-comment-id="${c.id}">
        <div class="tc-comment-time">${this.formatTime(c.timestamp)}</div>
        <div class="tc-comment-content">
          <strong>${c.authorName || c.author}:</strong> ${c.text}
        </div>
        <div class="tc-comment-actions">
          <button class="tc-like" data-comment-id="${c.id}">
            ${c.likedByUser ? '❤️' : '🤍'} ${c.likes || 0}
          </button>
          <button class="tc-reply" data-comment-id="${c.id}">💬 ${(c.replies || []).length}</button>
          <button class="tc-report" data-comment-id="${c.id}" title="Report inappropriate content">🚩</button>
        </div>
        ${(c.replies || []).length > 0 ? `
          <div class="tc-replies">
            ${c.replies.map(r => `
              <div class="tc-reply">
                <strong>${r.authorName}:</strong> ${r.text}
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `).join('');

    // Add click listeners to jump to timestamp
    list.querySelectorAll('.tc-comment').forEach(el => {
      el.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tc-like') && 
            !e.target.classList.contains('tc-reply') && 
            !e.target.classList.contains('tc-report')) {
          const timestamp = parseInt(el.dataset.timestamp);
          if (this.videoElement) {
            this.videoElement.currentTime = timestamp;
          }
        }
      });
    });
    
    // Add like button listeners
    list.querySelectorAll('.tc-like').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const commentId = btn.dataset.commentId;
        await this.handleLikeComment(commentId);
      });
    });
    
    // Add reply button listeners
    list.querySelectorAll('.tc-reply').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const commentId = btn.dataset.commentId;
        this.showReplyInput(commentId);
      });
    });
    
    // Add report button listeners
    list.querySelectorAll('.tc-report').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const commentId = btn.dataset.commentId;
        await this.handleReportComment(commentId);
      });
    });
  }
  
  async handleReportComment(commentId) {
    if (!confirm('Report this comment as inappropriate?')) {
      return;
    }
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'REPORT_COMMENT',
        commentId,
        videoId: this.currentVideoId
      });
      
      if (response && response.success) {
        alert('Thank you for your report. We will review this comment.');
      } else {
        alert('Failed to submit report. Please try again.');
      }
    } catch (error) {
      console.error('Error reporting comment:', error);
      alert('Failed to submit report. Please try again.');
    }
  }
  
  async handleLikeComment(commentId) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'LIKE_COMMENT',
        commentId
      });
      
      if (response && response.success) {
        // Reload comments to show updated likes
        const loadResponse = await chrome.runtime.sendMessage({
          type: 'LOAD_COMMENTS',
          videoId: this.currentVideoId
        });
        
        if (loadResponse && loadResponse.success) {
          this.comments = loadResponse.comments;
          this.renderCommentsList();
        }
      }
    } catch (error) {
      console.error('Error liking comment:', error);
    }
  }
  
  showReplyInput(commentId) {
    const commentEl = document.querySelector(`[data-comment-id="${commentId}"]`);
    if (!commentEl) return;
    
    // Check if reply input already exists
    if (commentEl.querySelector('.tc-reply-input')) return;
    
    const replyDiv = document.createElement('div');
    replyDiv.className = 'tc-reply-input';
    replyDiv.innerHTML = `
      <input type="text" placeholder="Write a reply..." class="tc-reply-text" />
      <button class="tc-reply-submit">Reply</button>
    `;
    
    commentEl.appendChild(replyDiv);
    
    const input = replyDiv.querySelector('.tc-reply-text');
    const submitBtn = replyDiv.querySelector('.tc-reply-submit');
    
    input.focus();
    
    // Prevent keyboard events from reaching video player
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
    });

    input.addEventListener('keyup', (e) => {
      e.stopPropagation();
    });
    
    const handleReply = async () => {
      const text = input.value.trim();
      if (!text) return;
      
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'ADD_REPLY',
          commentId,
          text
        });
        
        if (response && response.success) {
          // Reload comments
          const loadResponse = await chrome.runtime.sendMessage({
            type: 'LOAD_COMMENTS',
            videoId: this.currentVideoId
          });
          
          if (loadResponse && loadResponse.success) {
            this.comments = loadResponse.comments;
            this.renderCommentsList();
          }
        }
      } catch (error) {
        console.error('Error adding reply:', error);
      }
    };
    
    submitBtn.addEventListener('click', handleReply);
    
    input.addEventListener('keypress', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') handleReply();
    });
  }

  displayComments(comments) {
    // Display comments on video overlay (like the React demo)
    // This would create floating comment bubbles
    console.log('Active comments:', comments);
  }

  formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  cleanup() {
    // Clean up when extension is unloaded
    if (this.realtimeInterval) {
      clearInterval(this.realtimeInterval);
      this.realtimeInterval = null;
    }
    console.log('TimelineComments: Cleaned up');
  }
}

// Initialize when script loads
let injector = null;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injector = new VideoCommentInjector();
  });
} else {
  injector = new VideoCommentInjector();
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (injector) {
    injector.cleanup();
  }
});