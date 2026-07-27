/**
 * ===== Client-Side Image Compression Utility =====
 * Compresses images in-browser using Canvas API before uploading to the server.
 * 
 * Benefits:
 *  - Reduces image file size by 90–98% (e.g. 8MB JPEG → 120KB WebP)
 *  - Saves Firebase Storage space (5GB free limit)
 *  - Saves Firebase egress bandwidth (1GB/day free limit)
 *  - Speeds up uploads on slow mobile connections
 * 
 * Usage:
 *   const blob = await compressImage(fileInput.files[0]);
 *   const formData = new FormData();
 *   formData.append('avatar', blob, 'avatar.webp');
 */

/**
 * Compress an image file using Canvas API.
 * @param {File|Blob} file  The image file to compress
 * @param {object} options
 * @param {number} options.maxWidth   Max output width in px (default 800)
 * @param {number} options.maxHeight  Max output height in px (default 800)
 * @param {number} options.quality    JPEG/WebP quality 0–1 (default 0.82)
 * @param {string} options.format     'webp' | 'jpeg' | 'auto' (default 'auto')
 * @returns {Promise<Blob>}
 */
async function compressImage(file, {
  maxWidth = 800,
  maxHeight = 800,
  quality = 0.82,
  format = 'auto'
} = {}) {
  // Validate input
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('compressImage: input must be an image file');
  }

  // Skip compression for tiny files (< 100KB) — already small enough
  if (file.size < 100 * 1024) {
    return file;
  }

  // Determine best output format:
  // 1. Use WebP if browser supports it (best compression, wide support in 2024+)
  // 2. Fall back to JPEG for maximum compatibility
  let mimeType = 'image/jpeg';
  if (format === 'webp' || (format === 'auto' && canEncodeWebP())) {
    mimeType = 'image/webp';
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      try {
        // Calculate dimensions preserving aspect ratio
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        // Draw onto canvas (auto-corrects orientation via CSS image-orientation)
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // White background for transparent PNGs (JPEG doesn't support transparency)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              // Canvas toBlob failed (rare) — return original file
              resolve(file);
              return;
            }

            // If compression made it bigger (rare edge case), return original
            if (blob.size >= file.size) {
              resolve(file);
            } else {
              resolve(blob);
            }
          },
          mimeType,
          quality
        );
      } catch (err) {
        // Canvas failed (e.g. tainted cross-origin image) — return original
        resolve(file);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('compressImage: failed to load image'));
    };

    img.src = objectUrl;
  });
}

/**
 * Check if the browser can encode WebP via Canvas.
 * Cached after the first call to avoid repeated DOM creation.
 */
let _webpSupported = null;
function canEncodeWebP() {
  if (_webpSupported !== null) return _webpSupported;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    _webpSupported = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch (e) {
    _webpSupported = false;
  }
  return _webpSupported;
}

/**
 * Get a human-readable size string.
 * Useful for showing compression stats to users.
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Compress + show a visual progress indicator.
 * Use this in forms to give users feedback during compression.
 * @param {File} file
 * @param {HTMLElement} statusEl  Optional element to update with status text
 * @param {object} options  Same options as compressImage()
 * @returns {Promise<Blob>}
 */
async function compressImageWithStatus(file, statusEl, options = {}) {
  if (statusEl) {
    statusEl.textContent = `Compressing image (${formatFileSize(file.size)})...`;
    statusEl.className = 'text-xs text-on-surface-variant';
  }

  const compressed = await compressImage(file, options);

  if (statusEl) {
    if (compressed === file) {
      statusEl.textContent = `Image ready (${formatFileSize(file.size)})`;
    } else {
      const saved = Math.round((1 - compressed.size / file.size) * 100);
      statusEl.textContent = `Compressed: ${formatFileSize(file.size)} → ${formatFileSize(compressed.size)} (${saved}% smaller) ✓`;
      statusEl.className = 'text-xs text-primary font-medium';
    }
  }

  return compressed;
}
