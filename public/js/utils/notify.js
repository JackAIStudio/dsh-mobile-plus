/**
 * Notifications and audio chime for task completion.
 */
import { runtime } from '../state/state.js'

export function triggerTaskDoneNotification(title) {
    if (!notificationsEnabled) return;
    try {
      const audio = document.getElementById('peon-audio');
      if (audio && audioUnlocked) {
        audio.currentTime = 0;
        audio.play().catch(console.error);
      }
    } catch (e) { console.error('Audio play error', e); }
    
    if (notificationsEnabled && Notification.permission === 'granted') {
      try {
        navigator.serviceWorker.ready.then(registration => {
          registration.showNotification('任务完成', {
            body: title || '一个对话任务已完成',
            icon: '/mp/icon.png',
            tag: 'task-done',
            renotify: true
          });
        });
      } catch (e) {
        console.error('Push error', e);
      }
    }
  }
