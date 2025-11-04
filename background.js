// TimelineComments - Background Service Worker (Simplified)
// Using Firebase REST API instead of SDK to avoid CSP issues

importScripts('content-filter.js');

// Initialize content filter
const contentFilter = new ContentFilter();

// Rate limiting
const rateLimiter = {
  actions: {},
  limits: {
    comment: { max: 10, window: 60000 },
    like: { max: 30, window: 60000 },
    reply: { max: 20, window: 60000 }
  },
  
  check(userId, action) {
    if (!this.actions[userId]) {
      this.actions[userId] = {};
    }
    if (!this.actions[userId][action]) {
      this.actions[userId][action] = [];
    }
    
    const now = Date.now();
    const limit = this.limits[action];
    
    this.actions[userId][action] = this.actions[userId][action].filter(
      time => now - time < limit.window
    );
    
    if (this.actions[userId][action].length >= limit.max) {
      return false;
    }
    
    this.actions[userId][action].push(now);
    return true;
  }
};

// Firebase configuration
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDCA-Lr3q5t0nwjCi8MbKY-JgM_7lucbhs",
  projectId: "timeline-content-extension",
  databaseURL: "https://timeline-content-extension-default-rtdb.firebaseio.com"
};

let currentUser = null;

// Listen for extension installation
chrome.runtime.onInstalled.addListener(async () => {
  console.log('TimelineComments extension installed!');
  
  await chrome.storage.local.set({
    enabled: true,
    showOverlayByDefault: true
  });
  
  await initializeAuth();
});

// Initialize authentication using REST API
async function initializeAuth() {
  try {
    // Check if we have a stored user
    const stored = await chrome.storage.local.get(['userId', 'authToken']);
    
    if (stored.userId && stored.authToken) {
      currentUser = { uid: stored.userId, token: stored.authToken };
      console.log('TimelineComments: Restored user', currentUser.uid);
      return;
    }
    
    // Sign in anonymously via REST API
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_CONFIG.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnSecureToken: true })
      }
    );
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }
    
    currentUser = {
      uid: data.localId,
      token: data.idToken
    };
    
    // Store credentials
    await chrome.storage.local.set({
      userId: currentUser.uid,
      authToken: currentUser.token
    });
    
    // Create user profile
    await fetch(
      `${FIREBASE_CONFIG.databaseURL}/users/${currentUser.uid}.json?auth=${currentUser.token}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: `User${Math.floor(Math.random() * 10000)}`,
          createdAt: Date.now(),
          commentCount: 0,
          isAnonymous: true
        })
      }
    );
    
    console.log('TimelineComments: Authenticated as', currentUser.uid);
    
  } catch (error) {
    console.error('TimelineComments: Auth error', error);
  }
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_COMMENT') {
    handleSaveComment(message.data).then(sendResponse);
    return true;
  }
  
  if (message.type === 'LOAD_COMMENTS') {
    handleLoadComments(message.videoId).then(sendResponse);
    return true;
  }
  
  if (message.type === 'LIKE_COMMENT') {
    handleLikeComment(message.commentId).then(sendResponse);
    return true;
  }
  
  if (message.type === 'ADD_REPLY') {
    handleAddReply(message.commentId, message.text).then(sendResponse);
    return true;
  }
  
  if (message.type === 'REPORT_COMMENT') {
    handleReportComment(message.commentId, message.videoId).then(sendResponse);
    return true;
  }
});

// Save comment to Firebase via REST API
async function handleSaveComment(commentData) {
  try {
    if (!currentUser) {
      await initializeAuth();
    }
    
    if (!rateLimiter.check(currentUser.uid, 'comment')) {
      return { 
        success: false, 
        error: 'Rate limit exceeded. Please wait before posting again.' 
      };
    }
    
    const { videoId, text, timestamp, platform } = commentData;
    
    const filterResult = contentFilter.filterContent(text);
    if (!filterResult.isClean) {
      return {
        success: false,
        error: filterResult.violations.join('. ')
      };
    }
    
    // Get user profile
    const userResponse = await fetch(
      `${FIREBASE_CONFIG.databaseURL}/users/${currentUser.uid}.json?auth=${currentUser.token}`
    );
    const userData = await userResponse.json();
    
    if (userData?.banned) {
      return {
        success: false,
        error: 'Your account has been suspended.'
      };
    }
    
    // Create new comment
    const newComment = {
      text,
      timestamp: Math.floor(timestamp),
      authorId: currentUser.uid,
      authorName: userData.displayName || 'Anonymous',
      likes: 0,
      createdAt: Date.now(),
      platform
    };
    
    const response = await fetch(
      `${FIREBASE_CONFIG.databaseURL}/comments/${videoId}.json?auth=${currentUser.token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newComment)
      }
    );
    
    const result = await response.json();
    newComment.id = result.name;
    
    // Update comment count
    await fetch(
      `${FIREBASE_CONFIG.databaseURL}/users/${currentUser.uid}/commentCount.json?auth=${currentUser.token}`,
      {
        method: 'PUT',
        body: (userData.commentCount || 0) + 1
      }
    );
    
    await cacheCommentLocally(videoId, newComment);
    
    return { success: true, comment: newComment };
  } catch (error) {
    console.error('Error saving comment:', error);
    return { success: false, error: error.message };
  }
}

// Load comments from Firebase via REST API
async function handleLoadComments(videoId) {
  try {
    const response = await fetch(
      `${FIREBASE_CONFIG.databaseURL}/comments/${videoId}.json`
    );
    
    const data = await response.json();
    
    if (!data) {
      return { success: true, comments: [] };
    }
    
    const comments = Object.keys(data).map(key => ({
      id: key,
      ...data[key],
      replies: [],
      likedByUser: false
    }));
    
    // Sort by timestamp
    comments.sort((a, b) => a.timestamp - b.timestamp);
    
    // Load replies and likes for each comment
    for (const comment of comments) {
      // Load replies
      const repliesResponse = await fetch(
        `${FIREBASE_CONFIG.databaseURL}/replies/${comment.id}.json`
      );
      const repliesData = await repliesResponse.json();
      
      if (repliesData) {
        comment.replies = Object.keys(repliesData).map(key => ({
          id: key,
          ...repliesData[key]
        }));
      }
      
      // Load like count
      const likesResponse = await fetch(
        `${FIREBASE_CONFIG.databaseURL}/likes/${comment.id}.json`
      );
      const likesData = await likesResponse.json();
      
      if (likesData) {
        comment.likes = Object.keys(likesData).length;
        comment.likedByUser = currentUser && likesData[currentUser.uid] === true;
      }
    }
    
    await chrome.storage.local.set({ [`comments_${videoId}`]: comments });
    
    return { success: true, comments };
  } catch (error) {
    console.error('Error loading comments:', error);
    
    const cached = await chrome.storage.local.get([`comments_${videoId}`]);
    return { success: true, comments: cached[`comments_${videoId}`] || [] };
  }
}

// Like a comment
async function handleLikeComment(commentId) {
  try {
    if (!currentUser) {
      await initializeAuth();
    }
    
    if (!rateLimiter.check(currentUser.uid, 'like')) {
      return { 
        success: false, 
        error: 'Rate limit exceeded.' 
      };
    }
    
    // Check if already liked
    const response = await fetch(
      `${FIREBASE_CONFIG.databaseURL}/likes/${commentId}/${currentUser.uid}.json?auth=${currentUser.token}`
    );
    const liked = await response.json();
    
    if (liked) {
      // Unlike
      await fetch(
        `${FIREBASE_CONFIG.databaseURL}/likes/${commentId}/${currentUser.uid}.json?auth=${currentUser.token}`,
        { method: 'DELETE' }
      );
      return { success: true, liked: false };
    } else {
      // Like
      await fetch(
        `${FIREBASE_CONFIG.databaseURL}/likes/${commentId}/${currentUser.uid}.json?auth=${currentUser.token}`,
        {
          method: 'PUT',
          body: 'true'
        }
      );
      return { success: true, liked: true };
    }
  } catch (error) {
    console.error('Error liking comment:', error);
    return { success: false, error: error.message };
  }
}

// Add reply to a comment
async function handleAddReply(commentId, text) {
  try {
    if (!currentUser) {
      await initializeAuth();
    }
    
    if (!rateLimiter.check(currentUser.uid, 'reply')) {
      return { 
        success: false, 
        error: 'Rate limit exceeded.' 
      };
    }
    
    const filterResult = contentFilter.filterContent(text);
    if (!filterResult.isClean) {
      return {
        success: false,
        error: filterResult.violations.join('. ')
      };
    }
    
    const userResponse = await fetch(
      `${FIREBASE_CONFIG.databaseURL}/users/${currentUser.uid}.json?auth=${currentUser.token}`
    );
    const userData = await userResponse.json();
    
    if (userData?.banned) {
      return { success: false, error: 'Your account has been suspended.' };
    }
    
    const newReply = {
      text,
      authorId: currentUser.uid,
      authorName: userData.displayName || 'Anonymous',
      createdAt: Date.now()
    };
    
    const response = await fetch(
      `${FIREBASE_CONFIG.databaseURL}/replies/${commentId}.json?auth=${currentUser.token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newReply)
      }
    );
    
    const result = await response.json();
    newReply.id = result.name;
    
    return { success: true, reply: newReply };
  } catch (error) {
    console.error('Error adding reply:', error);
    return { success: false, error: error.message };
  }
}

// Report a comment
async function handleReportComment(commentId, videoId) {
  try {
    if (!currentUser) {
      await initializeAuth();
    }
    
    const report = {
      commentId,
      videoId,
      reportedBy: currentUser.uid,
      reportedAt: Date.now(),
      status: 'pending'
    };
    
    await fetch(
      `${FIREBASE_CONFIG.databaseURL}/reports/${commentId}.json?auth=${currentUser.token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report)
      }
    );
    
    return { success: true };
  } catch (error) {
    console.error('Error reporting comment:', error);
    return { success: false, error: error.message };
  }
}

// Cache comment locally
async function cacheCommentLocally(videoId, comment) {
  try {
    const result = await chrome.storage.local.get([`comments_${videoId}`]);
    const comments = result[`comments_${videoId}`] || [];
    comments.push(comment);
    comments.sort((a, b) => a.timestamp - b.timestamp);
    await chrome.storage.local.set({ [`comments_${videoId}`]: comments });
  } catch (error) {
    console.error('Error caching comment:', error);
  }
}

console.log('TimelineComments: Background script loaded!');