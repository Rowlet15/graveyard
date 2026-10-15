# Graveyard Backups

Website for backing up **Graveyard**, a game for NumWorks calculators:
https://rowlet15.github.io/graveyard/

- In Graveyard, choose **BACKUP** on the title menu. The screen shows the save as a QR code.
- Scan it with a phone camera: the link opens this site and the backup is kept in that browser.
- Optional sync: connect each device to a private GitHub repository of yours (`graveyard-saves`)
  with a fine-grained token (Contents: read and write, that repository only). Every backup is
  also saved there as `backups/<date>_<check>.txt`, so a backup scanned on the phone shows up
  on the computer.
- After a calculator reset, open the backup in Chrome or Edge on a computer, plug in the
  calculator, and click **Restore to calculator** to put it back over USB.

Files: `index.html` and `app.js` (the site), `gy-core.js` (the backup format, shared with the
game's source), `gy-usb.js` (USB restore), `jsQR.js` (QR reading, Apache 2.0, see
`jsQR-LICENSE.txt`). Nothing is sent anywhere except, with sync on, your own GitHub repository.
