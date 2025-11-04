class VideoCommentInjector {
  constructor() {
    this.platform = this.detectPlatform();
    this.videoElement = null;
    this.currentVideoId = null;
    this.comments = [];
    this.overlayContainer = null;
    this.contentFilter = new ContentFilter();
    this.realtimeInterval = null;
    
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
    
    // Extract video information
    this.extractVideoInfo();
    
    // Load comments for this video
    this.loadComments();
    
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
        
        // Re-extract video info
        this.extractVideoInfo();
        
        // Clear old comments
        this.comments = [];
        
        // Stop old polling
        if (this.realtimeInterval) {
          clearInterval(this.realtimeInterval);
          this.realtimeInterval = null;
        }
        
        // Reload comments for new video
        this.loadComments();
        
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

  extractVideoInfo() {
    // Extract what's playing from URL and page metadata
    const url = window.location.href;
    console.log('TimelineComments: Extracting from URL:', url);
    
    if (this.platform === 'netflix') {
      // Netflix URL: /watch/81234567 (show/movie ID)
      // For TV shows, episodes have: ?trackId=14170286 (episode ID)
      const match = url.match(/\/watch\/(\d+)/);
      const showId = match ? match[1] : null;
      
      // Check for episode-specific trackId
      const trackMatch = url.match(/[?&]trackId=(\d+)/);
      
      if (trackMatch) {
        // TV Episode - use showId + trackId for uniqueness
        this.currentVideoId = `netflix_${showId}_ep_${trackMatch[1]}`;
        console.log('TimelineComments: Detected TV Episode');
      } else {
        // Movie or show landing - just use showId
        this.currentVideoId = `netflix_${showId}`;
        console.log('TimelineComments: Detected Movie');
      }
      
    } else if (this.platform === 'disneyplus') {
      // Disney+ URL: /video/[guid]
      // Episodes have different GUIDs, so this should work
      const match = url.match(/\/video\/([^?]+)/);
      this.currentVideoId = match ? `disneyplus_${match[1]}` : null;
      
    } else if (this.platform === 'hulu') {
      // Hulu URL: /watch/[id]
      // Episodes have different IDs
      const match = url.match(/\/watch\/([^?]+)/);
      this.currentVideoId = match ? `hulu_${match[1]}` : null;
    }

    console.log(`TimelineComments: Video ID = ${this.currentVideoId}`);
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
    });

    this.videoElement.addEventListener('pause', () => {
      console.log('TimelineComments: Video paused');
    });
  }

  onTimeUpdate() {
    if (!this.videoElement) return;
    
    const currentTime = Math.floor(this.videoElement.currentTime);
    
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
    if (!text.trim() || !this.videoElement) return;
    
    // Filter content before sending
    const filterResult = this.contentFilter.filterContent(text);
    
    if (!filterResult.isClean) {
      // Show error message
      this.showError(filterResult.violations.join('. '));
      return;
    }

    const timestamp = this.videoElement.currentTime;
    
    try {
      await this.saveComment(text, timestamp);
      
      // Clear input
      document.getElementById('tc-comment-input').value = '';
      
      // Re-render list
      this.renderCommentsList();
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
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
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