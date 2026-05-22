# Pint-me — Clean rebuild (no service worker)

This is a fresh rebuild to avoid the "buttons don't work" issue caused by HTML-escaped JavaScript.

## Upload to GitHub Pages

1. Create a repo (e.g. `Pint-me`)
2. Upload the contents of this folder to the **repo root** (so `index.html` is in the root)
3. Enable GitHub Pages: Settings → Pages → Deploy from branch → `main` / `/ (root)`

## Firebase checklist

1) Firebase Console → Authentication → Sign-in method → enable **Anonymous**

2) Firestore → Rules:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /groups/{groupCode}/presence/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## Notes

- Default group code is `cominghome`.
- Turning OFF / Reset / Expiry deletes your presence doc so matches disappear.
- This build intentionally has **no service worker** to avoid sticky cache issues during iteration.
