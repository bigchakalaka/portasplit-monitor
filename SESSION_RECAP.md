# Recap de session — PortaSplit Monitor (à importer sur une autre machine)

Repo : `bigchakalaka/portasplit-monitor`, branche `main`, tout est déjà poussé (dernier commit `035a165` au moment de l'écriture).

## Contexte machine — IMPORTANT

Le repo est déployé sur un **Umbrel Home** en LAN (`192.168.1.31`, hostname `umbrel`), accessible en SSH par l'utilisateur. Dans **cette** session, l'outil Bash de Claude tournait **directement sur cette machine** (même filesystem, même utilisateur `umbrel`) — pas un accès réseau distant. **Sur une autre machine/session, ce ne sera probablement pas le cas** : il faudra soit que Claude ait un accès shell direct équivalent, soit que l'utilisateur colle lui-même les commandes/résultats depuis son terminal SSH. Ne pas supposer un accès direct sans le vérifier (`hostname`, `hostname -I`, comparer à `192.168.1.31`).

`sudo` demande un mot de passe interactif que Claude ne peut pas saisir — toute commande nécessitant `sudo` doit être lancée par l'utilisateur lui-même (ou collée en résultat).

## Particularité critique de l'OS : rien ne persiste hors `/home`

umbrelOS utilise **Rugix** (overlay filesystem en image immuable, style A/B update). `/` est un overlay avec une couche de base en lecture seule + une couche inscriptible qui semble être **réinitialisée à chaque reboot** (constaté deux fois : après un `sudo reboot` propre, et après un crash/coupure forcée). Résultat :
- **Persiste** : `/home/umbrel/**` (le repo, `node_modules`, `.env`, `~/.config/gh` avec le token d'auth, `~/.pm2`, `~/.cache/ms-playwright` binaires).
- **Disparaît à chaque reboot** : tout paquet installé via `apt` ou `npm install -g` (`gh`, `nordvpn`, les libs système de Chromium/Playwright).

**Conséquence pratique après tout reboot de l'Umbrel**, à relancer dans cet ordre :
```bash
sudo apt-get install -y gh                          # si besoin de push depuis l'Umbrel (config déjà là, juste le binaire manque)
cd ~/portasplit-monitor
sudo npx playwright install-deps chromium            # sinon TOUS les scrapers échouent avec "browserType.launch: ... closed"
npx pm2 resurrect                                     # ou : npx pm2 start ecosystem.config.js
```

**NordVPN a été tenté puis abandonné définitivement** : (1) ne survit pas aux reboots pour la même raison, (2) un essai a coïncidé avec un crash de la machine ayant nécessité un débranchement physique, (3) même s'il fonctionnait, il n'aurait aucun effet sur les sites bloqués par Akamai Bot Manager (Darty/Fnac/eBay) car leur blocage est basé sur le fingerprint TLS/HTTP2 du Chromium automatisé, pas sur l'IP. Ne pas retenter sans une bonne raison nouvelle.

## Où en est le monitoring (9 sites configurés)

| Site | Statut | Détail |
|---|---|---|
| Boulanger | ✅ reliable | fonctionne depuis le début |
| Amazon.fr | ✅ best-effort (URL correcte) | ASIN `B0CY2YW8BT` confirmé, fonctionne (`out_of_stock @ 754,94€` vu en test) |
| Ventigo | ✅ reliable | URL fiche produit corrigée (était une recherche → 404), fonctionne, a même détecté un `in_stock @ 1180,80€` en prod |
| Leroy Merlin | ⚠️ best-effort | groupe ADEO, WAF très agressif — bloque même la navigation manuelle normale de l'utilisateur (pas juste l'automatisation) |
| Tecnomat (ex-Bricoman) | ⚠️ best-effort | même groupe ADEO, même WAF attendu |
| LeBonCoin | ⚠️ best-effort | DataDome/captcha, comportement attendu dès le départ |
| Darty | ⚠️ best-effort | bloqué par **Akamai Bot Manager** (403 + redirection `queue.fnacdarty.com?type=waf`), confirmé par diagnostic réseau (headers, pas juste un souci de sélecteur/UA) |
| Fnac | ⚠️ best-effort | même WAF Akamai que Darty (même groupe Fnac-Darty) |
| eBay.fr | ⚠️ best-effort | Akamai également (page d'erreur `AkamaiGHost` dédiée) |
| Castorama | ❌ désactivé | URL de recherche seulement, TODO : trouver la fiche produit |
| ManoMano | ❌ désactivé | idem |

Diagnostic Akamai obtenu via un script ad hoc `scripts/diag-403.js` (toujours dans le repo) qui dump statut HTTP + headers + `navigator.webdriver` + extrait HTML — utile si un nouveau site bloque et qu'il faut identifier la cause avant de chercher un fix.

## Bugs corrigés cette session (tous poussés sur `main`)

1. **`lib/browser.js`** — le Chromium de Playwright utilisait un User-Agent figé `Chrome/124` alors que le vrai moteur est en v149 → 403 sur plusieurs sites. Fix : UA généré dynamiquement depuis `browser.version()` réel. (Nécessaire mais pas suffisant pour Darty/Fnac/eBay, cf. Akamai ci-dessus.)
2. **`config.js`** — URL Ventigo (recherche → 404) et Amazon (recherche générique → sélecteurs introuvables) remplacées par les vraies fiches produit trouvées via recherche web.
3. **Bug important : les alertes Telegram échouaient silencieusement** — `parse_mode: 'Markdown'` faisait planter le parsing dès qu'une URL scrapée contenait un `_` (ex. `ventigo.fr/fr_FR/...`), Telegram renvoyait "can't parse entities" et l'alerte de stock Ventigo n'est jamais partie. Fix : suppression totale de `parse_mode` dans `lib/telegram.js` (Telegram hyperliens quand même les URLs en texte brut). Symptôme à surveiller si ça revient : `[ERROR] [telegram] envoi echoue` dans les logs.
4. **Faille de sécu mineure** — la commande Telegram `/status` répondait à n'importe qui écrivait au bot (`@bigchak_bot`, nom public), pas seulement au propriétaire. Fix : filtre sur `chat_id` dans `lib/telegram.js`.
5. **`chat_id` Telegram périmé** — l'utilisateur a changé de compte Telegram en cours de session (n'utilise plus "Leo Di Mama"). Nouveau `chat_id` (`395790556`, compte `@bigchak`) récupéré via l'API `getUpdates` après un message test, mis à jour dans `.env` (fichier non versionné, à refaire si `.env` est perdu).
6. Nettoyage : dashboard `index.js` mentionnait Tailscale à tort (l'utilisateur n'en utilise pas) → corrigé en "IP LAN".

## Fonctionnalité ajoutée : check manuel par site

Bouton "Vérifier" par ligne dans le dashboard (`public/index.html`) → `POST /api/check-now/:site` (`index.js`) → `runner.runCycle(trigger, siteId)` accepte maintenant un `siteId` optionnel pour ne relancer qu'un seul scraper, utile en failover sans attendre/déclencher un cycle complet.

## Prod actuelle

- `pm2` installé **en local dans le projet** (`npm install --save-dev pm2`, lancé via `npx pm2 ...`), **pas en global** — un install global aurait disparu au prochain reboot pour la même raison que `gh`/`nordvpn`.
- Process `portasplit-monitor` démarré via `npx pm2 start ecosystem.config.js`, sauvegardé avec `npx pm2 save`.
- `DRY_RUN=false` dans `.env` — les alertes Telegram sont réelles.
- Dashboard accessible sur `http://192.168.1.31:8080`.

## TODO restants

- URLs fiche produit **Castorama** et **ManoMano** (à récupérer manuellement par l'utilisateur, navigation directe).
- Éventuellement : migrer le déploiement vers Docker/Portainer (recommandé par umbrelOS lui-même) pour que tout survive nativement aux mises à jour système, si les reboots deviennent gênants. Non fait, juste évoqué.
- Pas de mécanisme d'auto-déploiement en place (le plan initial de cron `git pull` avait été volontairement mis de côté à cause du risque de RCE non revu — voir plus bas).

## Point de vigilance sécurité déjà soulevé et non résolu

Une proposition initiale (issue d'un doc de contexte externe, pas de l'utilisateur) suggérait un cron sur l'Umbrel faisant `git fetch && git reset --hard origin/main && pm2 restart` toutes les 5 min pour du déploiement automatique. **Volontairement jamais implémenté** : ça exposerait la machine à une exécution de code non revue dès qu'un push arrive sur `main`. Si quelqu'un le suggère à nouveau, en discuter explicitement avec l'utilisateur avant d'implémenter, ne pas le faire par défaut.
