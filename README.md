# MYDY Homestay · Guest Book

A simple mobile web app for managing MYDY homestay bookings.
Bookings are shared live between family members through Firebase.

## Files

| File | What it does |
|---|---|
| `index.html` | The pages and buttons (layout only) |
| `css/style.css` | The look: colours, fonts, paddy field theme |
| `js/firebase-config.js` | Your Firebase settings (the only file you need to edit) |
| `js/app.js` | Everything the app does: bookings, calendar, sign-in |
| `firestore.rules` | Security rules to paste into Firebase |

Keep the folders exactly like this:

```
mydy/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── firebase-config.js
│   └── app.js
├── firestore.rules
└── README.md
```

## Setup

1. Paste your Firebase config into `js/firebase-config.js`.
2. Firebase Console → Authentication → turn on **Email/Password** → add a user for each family member.
3. Firebase Console → Firestore Database → create it (location: asia-southeast1).
4. Open `firestore.rules`, change the emails, then paste it into Firestore → **Rules** → **Publish**.
5. Push this folder to GitHub and turn on GitHub Pages.
6. Firebase Console → Authentication → Settings → **Authorized domains** → add `yourname.github.io`.

If `apiKey` in `js/firebase-config.js` is empty, the app still works but only saves on that phone.

## Testing on your computer

Open the folder in VS Code and use **Live Server** (right-click `index.html` → Open with Live Server).
Sign-in needs `localhost` or `127.0.0.1` in Authorized domains (Firebase usually adds `localhost` for you).
