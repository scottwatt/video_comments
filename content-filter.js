class ContentFilter {
  constructor() {
    // List of prohibited words (add more as needed)
    this.profanityList = [
      // Explicit words
      'fuck', 'shit', 'bitch', 'ass', 'damn', 'cunt',
      'crap', 'piss', 'bastard', 'slut', 'whore',
      // Slurs and hate speech
      'n***a', 'f****t', 'r****d',
      // Add more as needed
    ];
    
    // Regex patterns for variations
    this.patterns = [
      /f+u+c+k+/gi,
      /s+h+i+t+/gi,
      /b+i+t+c+h+/gi,
      /a+s+s+h+o+l+e+/gi,
      /d+a+m+n+/gi,
      // Leetspeak variations
      /f[u\*\@]ck/gi,
      /sh[i\*]t/gi,
      /b[\*i]tch/gi,
      // Attempts to bypass with spaces or symbols
      /f\s*u\s*c\s*k/gi,
      /s\s*h\s*i\s*t/gi,
    ];
    
    // Spam detection patterns
    this.spamPatterns = [
      /(.)\1{10,}/gi, // Repeated characters (aaaaaaaaaa)
      /(https?:\/\/[^\s]+)/gi, // URLs
      /(\b\w+\b)(\s+\1){3,}/gi, // Repeated words
      /[A-Z]{20,}/g, // Excessive caps
    ];
  }
  
  // Main filtering function
  filterContent(text) {
    const result = {
      isClean: true,
      filteredText: text,
      violations: [],
      action: 'allow' // 'allow', 'warn', 'block'
    };
    
    // Check for profanity
    const profanityCheck = this.checkProfanity(text);
    if (!profanityCheck.isClean) {
      result.isClean = false;
      result.violations.push(...profanityCheck.violations);
      result.filteredText = profanityCheck.filtered;
      result.action = 'block'; // Or 'warn' to allow with asterisks
    }
    
    // Check for spam
    const spamCheck = this.checkSpam(text);
    if (!spamCheck.isClean) {
      result.isClean = false;
      result.violations.push(...spamCheck.violations);
      result.action = 'block';
    }
    
    // Check length
    if (text.length > 500) {
      result.isClean = false;
      result.violations.push('Text too long (max 500 characters)');
      result.action = 'block';
    }
    
    if (text.trim().length < 2) {
      result.isClean = false;
      result.violations.push('Text too short');
      result.action = 'block';
    }
    
    return result;
  }
  
  // Check for profanity
  checkProfanity(text) {
    const result = {
      isClean: true,
      filtered: text,
      violations: []
    };
    
    const lowerText = text.toLowerCase();
    
    // Check against word list
    for (const word of this.profanityList) {
      if (lowerText.includes(word)) {
        result.isClean = false;
        result.violations.push(`Inappropriate language: ${word}`);
        // Replace with asterisks
        const regex = new RegExp(word, 'gi');
        result.filtered = result.filtered.replace(regex, '*'.repeat(word.length));
      }
    }
    
    // Check against patterns
    for (const pattern of this.patterns) {
      if (pattern.test(text)) {
        result.isClean = false;
        result.violations.push('Inappropriate language detected');
        result.filtered = text.replace(pattern, (match) => '*'.repeat(match.length));
      }
    }
    
    return result;
  }
  
  // Check for spam
  checkSpam(text) {
    const result = {
      isClean: true,
      violations: []
    };
    
    for (const pattern of this.spamPatterns) {
      if (pattern.test(text)) {
        result.isClean = false;
        
        if (pattern === this.spamPatterns[0]) {
          result.violations.push('Excessive repeated characters');
        } else if (pattern === this.spamPatterns[1]) {
          result.violations.push('URLs not allowed');
        } else if (pattern === this.spamPatterns[2]) {
          result.violations.push('Excessive repeated words');
        } else if (pattern === this.spamPatterns[3]) {
          result.violations.push('Excessive capital letters');
        }
      }
    }
    
    return result;
  }
  
  // Quick check - just returns true/false
  isContentAppropriate(text) {
    const result = this.filterContent(text);
    return result.isClean;
  }
  
  // Get filtered version with asterisks
  getSafeVersion(text) {
    const result = this.filterContent(text);
    return result.filteredText;
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ContentFilter;
}

// Make available globally for extension
if (typeof window !== 'undefined') {
  window.ContentFilter = ContentFilter;
}