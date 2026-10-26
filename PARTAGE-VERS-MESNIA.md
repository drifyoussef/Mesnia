# Partager une recette vers Mesnia (iOS + Android)

Objectif : dans TikTok, Instagram, Facebook, Safari, Chrome… « Partager » → **Mesnia** → l'app s'ouvre sur
« Ajouter une recette » et l'IA importe la recette toute seule.

## Ce qui est déjà fait (côté app)

`src/app/services/share-intake.service.ts` est le point d'entrée unique :

- `mesnia://import?url=<lien encodé>` (deep link) est déjà écouté via `@capacitor/app` ;
- `handleIncoming(texte)` accepte un lien ou le texte brut d'un partage
  (« Regarde ça ! https://vm.tiktok.com/xyz »), en extrait le lien et ouvre
  `/tabs/add-recipe?url=...`, qui lance l'import IA automatiquement.

Il reste la partie native : faire apparaître Mesnia dans la feuille de partage et transmettre ce qui est partagé
à `handleIncoming()`.

## 1. Aligner Capacitor et créer les projets natifs ✅

Fait : tous les paquets `@capacitor/*` sont en v8, et les projets `android/` et `ios/` existent et sont versionnés
(le schéma `mesnia://` y est déclaré : intent-filter Android, `CFBundleURLTypes` iOS).

> Sur téléphone, `environment.apiUrl` ne peut pas être `localhost` : il faut l'IP du PC sur le réseau local
> pendant le dev, puis l'URL du serveur en production.

## 2. Plugin de partage

Un plugin qui gère les deux plateformes, par exemple [`send-intent`](https://github.com/carsten-klaffke/send-intent)
(vérifier la version compatible Capacitor 8 et son README au moment de l'installation).

Brancher ce qu'il reçoit sur le service existant, au démarrage et à chaque retour au premier plan :

```ts
// app.component.ts (après shareIntake.init())
const received = await SendIntent.checkSendIntentReceived();
shareIntake.handleIncoming(received?.url || received?.description || received?.title);
```

## 3. Android

Dans `android/app/src/main/AndroidManifest.xml`, sur l'activité principale :

```xml
<!-- Mesnia dans la feuille de partage (texte / liens) -->
<intent-filter>
  <action android:name="android.intent.action.SEND" />
  <category android:name="android.intent.category.DEFAULT" />
  <data android:mimeType="text/plain" />
</intent-filter>

<!-- Deep link mesnia://import?url=... -->
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="mesnia" android:host="import" />
</intent-filter>
```

## 4. iOS (sur Mac, dans Xcode)

1. **Deep link** : `Info.plist` → `URL types` → schéma `mesnia`.
2. **Share Extension** : *File → New → Target → Share Extension*, puis dans son `Info.plist` :
   - `NSExtensionActivationSupportsWebURLWithMaxCount` = 1
   - `NSExtensionActivationSupportsText` = YES
3. **App Group** commun à l'app et à l'extension (*Signing & Capabilities → App Groups*) : l'extension y dépose
   le lien, l'app le lit au retour au premier plan. C'est ce que fait `send-intent` (suivre son README pour
   le code Swift de l'extension). Apple ne permet pas à une extension d'ouvrir directement l'app.
