# Pint-me — Layout v2

This layout matches your requested flow:

1) Group code + Display name at the top
2) Pint section (duration, radius, optional location)
3) **No Save button**: the **toggle switch publishes** when required fields are filled
4) Matches below

### Notes
- Location is optional. If you don't set it, you can still go ON, but distance filtering requires location.
- Turning OFF deletes your presence doc immediately.
- No service worker is included (avoids caching issues while iterating).

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
