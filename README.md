# Mesnia - Meal Decision App

Mesnia est une application mobile qui aide les couples, colocataires et familles à décider ensemble quoi manger chaque jour.

## 🚀 Fonctionnalités MVP

### ✅ Gestion des Recettes
- Ajout depuis TikTok, Instagram, URL ou manuellement
- Bibliothèque partagée entre membres du foyer
- Filtrage par temps, difficulté, type de repas
- Système de favoris

### ✅ Swipe Matching
- Interface de swipe quotidienne
- Match quand tous les membres approuvent une recette
- Historique des repas choisis

### ✅ Liste de Courses
- Génération automatique depuis les recettes matchées
- Organisation par catégories
- Ajout d'articles manuels
- Cochage des articles achetés

### ✅ Gestion de Foyer
- Création et gestion de foyer
- Invitation de membres
- Profils utilisateurs

## 🛠️ Technologies

- **Frontend**: Ionic 7 + Angular 17
- **Mobile**: Capacitor 5
- **Backend**: Supabase
- **Notifications**: Firebase Cloud Messaging
- **Language**: TypeScript

## 📦 Installation

\`\`\`bash
# Installer les dépendances
npm install

# Lancer en mode développement
npm start

# Build pour production
npm run build
\`\`\`

## 📱 Développement Mobile

Les projets natifs `android/` et `ios/` (Capacitor 8) sont versionnés.
Prérequis : Android Studio (JDK 21 inclus) pour Android, un Mac avec Xcode 26+ pour iOS.

\`\`\`bash
# Copier le build web dans les projets natifs
npm run build
npx cap sync

# Ouvrir dans l'IDE natif
npx cap open android
npx cap open ios
\`\`\`

## ⚙️ Configuration

1. Créer un projet Supabase sur [supabase.com](https://supabase.com)
2. Créer un projet Firebase pour les notifications
3. Copier les clés dans `src/environments/environment.ts`

## 🗄️ Structure de la Base de Données (Supabase)

### Tables

**users**
- id (uuid, primary key)
- email (text)
- display_name (text)
- avatar_url (text)
- created_at (timestamp)

**households**
- id (uuid, primary key)
- name (text)
- created_by (uuid, foreign key → users)
- invite_code (text, unique)
- members (jsonb)
- created_at (timestamp)

**recipes**
- id (uuid, primary key)
- household_id (uuid, foreign key → households)
- title (text)
- description (text)
- image_url (text)
- source_url (text)
- source_platform (text)
- ingredients (jsonb)
- prep_time (integer)
- cook_time (integer)
- total_time (integer)
- difficulty (text)
- servings (integer)
- meal_type (text)
- created_by (uuid, foreign key → users)
- is_favorite (boolean)
- times_cooked (integer)
- created_at (timestamp)

**swipe_sessions**
- id (uuid, primary key)
- household_id (uuid, foreign key → households)
- date (date)
- status (text)
- recipes (text[])
- swipes (jsonb)
- matched_recipe_id (uuid)
- created_at (timestamp)
- expires_at (timestamp)

**shopping_lists**
- id (uuid, primary key)
- household_id (uuid, foreign key → households)
- items (jsonb)
- recipe_ids (text[])
- status (text)
- created_at (timestamp)
- completed_at (timestamp)

## 📝 Scripts SQL Supabase

Consultez le fichier `supabase-schema.sql` pour les requêtes de création de tables.

## 🎨 Design System

L'application utilise le système de couleurs Ionic avec des personnalisations:
- **Primary**: Indigo (#6366f1)
- **Secondary**: Rose (#ec4899)
- **Success**: Emerald (#10b981)

## 🚧 Roadmap Post-MVP

- [ ] Notifications push
- [ ] Notes sur recettes
- [ ] Planification hebdomadaire
- [ ] Scan de codes-barres
- [ ] Export PDF de liste de courses
- [ ] Intégration services de livraison

## 📄 License

Copyright © 2026 Mesnia. Tous droits réservés.
