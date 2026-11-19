// Windows toasts when a card newly needs the manager, shelled out through powershell.exe from WSL.
// The set of cards already needing them lives in memory: the first call only remembers, so a server start never toasts.

function toastScript(title, text) {
  const q = (s) => s.replace(/'/g, "''");
  return [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
    `$x.GetElementsByTagName('text')[0].AppendChild($x.CreateTextNode('${q(title)}')) | Out-Null`,
    `$x.GetElementsByTagName('text')[1].AppendChild($x.CreateTextNode('${q(text)}')) | Out-Null`,
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('work-brain').Show([Windows.UI.Notifications.ToastNotification]::new($x))",
  ].join('; ');
}

// (rows from routes.cards) => void; toasts once for each card whose state became `needs you` since the previous call.
function needsYouNotifier({ spawn, log }) {
  let prev = null;
  return (rows) => {
    const now = new Set(rows.filter((r) => r.state === 'needs you').map((r) => r.folder));
    const fresh = prev ? rows.filter((r) => now.has(r.folder) && !prev.has(r.folder)) : [];
    prev = now;
    for (const r of fresh) {
      try {
        spawn('powershell.exe', ['-NoProfile', '-Command', toastScript('work-brain: needs you', String(r.title || r.folder).slice(0, 120))], { stdio: 'ignore', detached: true })
          .on('error', (err) => log(`toast failed for ${r.folder}: ${err.message}`)).unref();
      } catch (err) {
        log(`toast failed for ${r.folder}: ${err.message}`);
      }
    }
  };
}

module.exports = { needsYouNotifier };
