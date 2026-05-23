# Pint-me — Layout v3

Changes vs v2:

- **Location is required** (you can’t go ON until location is set).
- Toggle is the publish/unpublish action.
- Meet here is optional and appears **below matches**.
- No service worker (avoids caching problems while iterating).

## Firebase checklist
- Enable Anonymous auth
- Firestore rules:

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

## Common reason location fails
If the browser has blocked location permission for your site, re-enable it in browser settings.
