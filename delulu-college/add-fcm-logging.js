// Quick script to add FCM debug logging to server.js
// This will help you see EXACTLY what's happening when notifications are sent

const fs = require('fs');

const serverPath = './server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find the sendPushNotification function and add detailed logging
const fcmSectionStart = content.indexOf('// 2. Firebase Admin FCM Native Push Notification');
const fcmSectionEnd = content.indexOf('} catch (fcmErr) {}', fcmSectionStart);

if (fcmSectionStart > 0 && fcmSectionEnd > 0) {
  // Add logging after getting tokens
  const tokensLine = content.indexOf('const allTokens = [...new Set([...(legacyTokens || []), ...deviceTokens])];', fcmSectionStart);
  if (tokensLine > 0) {
    const insertPos = content.indexOf('\n', tokensLine) + 1;
    const logStatement = `          console.log('[FCM] Sending notification to user', numUserId, '- Found', allTokens.length, 'FCM tokens:', allTokens.map(t => t.substring(0, 20) + '...'));\n`;
    content = content.slice(0, insertPos) + logStatement + content.slice(insertPos);
  }

  // Add logging for successful sends
  const sendLine = content.indexOf('fcmPromises.push(messaging.send(message).then(() => true, fcmErr => {', fcmSectionStart);
  if (sendLine > 0) {
    const insertPos = content.indexOf('=> true', sendLine) + 7;
    content = content.slice(0, insertPos) + ` && (console.log('[FCM] ✓ Notification sent successfully to token', token.substring(0, 20) + '...'), true)` + content.slice(insertPos);
  }

  // Replace silent catch with logging catch
  content = content.replace('} catch (fcmErr) {}', `} catch (fcmErr) {
      console.error('[FCM] ✗ Failed to send notification:', fcmErr.message, fcmErr.code);
    }`);

  fs.writeFileSync(serverPath, content, 'utf8');
  console.log('✓ Added FCM debug logging to server.js');
  console.log('  Restart your server to see detailed FCM logs');
} else {
  console.log('✗ Could not find FCM section in server.js');
}
