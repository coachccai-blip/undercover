/* ==========================================================================
   Undercover — logique applicative
   Vanilla JS, aucune dépendance. Tout est local (mémoire + localStorage).
   ========================================================================== */
(function () {
  'use strict';

  var VERSION = '1.2.0';
  var STORAGE_KEY = 'undercover.played.v1';

  var MIN_PLAYERS = 3;
  var MAX_PLAYERS = 20;
  var MIN_HUMANS_WITH_BOTS = 2;
  var MAX_BOTS = 8;
  var ALL_THEMES = '*';

  /* ---------------------------------------------------------------- État */

  // Paramètres de la session (mémoire vive uniquement : perdus au menu).
  var config = null;

  // Partie en cours de distribution.
  var game = null;

  var currentScreen = 'home';
  var backGuardArmed = false;

  function defaultConfig() {
    return {
      playerCount: 6,
      botCount: 0,
      undercoverCount: 1,
      names: buildDefaultNames(6, []),
      themeId: ALL_THEMES,
      proximity: 3,
      knowRole: false,
      knowAllies: false
    };
  }

  function buildDefaultNames(count, previous) {
    var names = [];
    for (var i = 0; i < count; i++) {
      names.push(previous && previous[i] ? previous[i] : defaultName(i));
    }
    return names;
  }

  function defaultName(index) {
    return 'Joueur ' + (index + 1);
  }

  function botName(index) {
    return 'Robot ' + (index + 1);
  }

  /** Un robot ne tient pas le téléphone : il faut au moins deux humains. */
  function minHumans() {
    return config.botCount > 0 ? MIN_HUMANS_WITH_BOTS : MIN_PLAYERS;
  }

  function totalPlayers() {
    return config.playerCount + config.botCount;
  }

  /** Liste ordonnée des participants : humains d'abord, puis robots. */
  function buildParticipants() {
    var list = resolvedNames().map(function (name) {
      return { name: name, bot: false };
    });
    for (var i = 0; i < config.botCount; i++) {
      list.push({ name: botName(i), bot: true });
    }
    return list;
  }

  /**
   * Niveaux du curseur, du plus proche au plus éloigné.
   * `scores` liste les proximités de paires acceptées ; `mix` construit le
   * couple à partir de deux paires différentes (mots volontairement sans
   * rapport), ce que la banque de paires curées ne peut pas fournir seule.
   */
  var PROXIMITY_LEVELS = [
    { value: 1, name: 'Très proche',  hint: 'Deux mots presque interchangeables.', scores: [5] },
    { value: 2, name: 'Proche',       hint: 'Même famille, mais distinction nette.', scores: [4] },
    { value: 3, name: 'Varié',        hint: 'Toutes les paires, au hasard.', scores: null },
    { value: 4, name: 'Éloigné',      hint: 'Les paires les plus lointaines de la thématique.', scores: [2, 3] },
    { value: 5, name: 'Très éloigné', hint: 'Deux mots tirés de paires différentes, sans rapport.', mix: true }
  ];

  function proximityLevel(value) {
    return PROXIMITY_LEVELS[clamp(value, 1, PROXIMITY_LEVELS.length) - 1];
  }

  function maxUndercovers(total) {
    // Contrainte : strictement inférieur à la moitié des participants.
    return Math.max(1, Math.ceil(total / 2) - 1);
  }

  /* ------------------------------------------------- Persistance (paires) */

  function loadPlayed() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function savePlayed(played) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(played));
    } catch (err) {
      /* Stockage indisponible (navigation privée) : on continue en mémoire. */
    }
  }

  // Structure : { "t1": [3, 17, 42], ... } — index des paires déjà jouées.
  var playedStore = loadPlayed();

  function playedSet(themeId) {
    var list = playedStore[themeId];
    return Array.isArray(list) ? list : [];
  }

  function markPlayed(themeId, pairIndex) {
    var list = playedSet(themeId).slice();
    if (list.indexOf(pairIndex) === -1) list.push(pairIndex);
    playedStore[themeId] = list;
    savePlayed(playedStore);
  }

  function resetTheme(themeId) {
    delete playedStore[themeId];
    savePlayed(playedStore);
  }

  function resetAllThemes() {
    playedStore = {};
    savePlayed(playedStore);
  }

  function themeById(id) {
    for (var i = 0; i < WORD_BANK.length; i++) {
      if (WORD_BANK[i].id === id) return WORD_BANK[i];
    }
    return null;
  }

  /* ------------------------------------------------------ Tirage de paire */

  function candidatesFor(themeId) {
    var themes = themeId === ALL_THEMES ? WORD_BANK : [themeById(themeId)];
    var candidates = [];
    themes.forEach(function (theme) {
      if (!theme) return;
      var played = playedSet(theme.id);
      for (var i = 0; i < theme.pairs.length; i++) {
        if (played.indexOf(i) === -1) candidates.push({ themeId: theme.id, index: i });
      }
    });
    return candidates;
  }

  function pairOf(ref) {
    return themeById(ref.themeId).pairs[ref.index];
  }

  function sideOf(pair, second, ref) {
    return second
      ? { fr: pair[1], en: pair[3], zh: pair[5], ref: ref }
      : { fr: pair[0], en: pair[2], zh: pair[4], ref: ref };
  }

  /**
   * Restreint les candidats aux paires du niveau de proximité demandé.
   * Si le niveau est vide (toutes ses paires ont déjà été jouées), on retombe
   * sur les paires dont la proximité s'en approche le plus.
   */
  function filterByProximity(candidates, scores) {
    if (!scores) return candidates;
    var pool = candidates.filter(function (ref) {
      return scores.indexOf(pairOf(ref)[6]) !== -1;
    });
    if (pool.length) return pool;

    var best = null;
    var distance = function (ref) {
      return Math.min.apply(null, scores.map(function (s) { return Math.abs(pairOf(ref)[6] - s); }));
    };
    candidates.forEach(function (ref) {
      var d = distance(ref);
      if (best === null || d < best) best = d;
    });
    return candidates.filter(function (ref) { return distance(ref) === best; });
  }

  /**
   * Tire les deux mots de la partie. Réinitialise le périmètre concerné si
   * toutes ses paires ont été jouées.
   * @returns {{words: {civil: object, under: object}, reset: boolean}}
   */
  function drawPair(themeId, proximity) {
    var level = proximityLevel(proximity);
    var didReset = false;
    var candidates = candidatesFor(themeId);

    if (candidates.length === 0) {
      if (themeId === ALL_THEMES) resetAllThemes();
      else resetTheme(themeId);
      didReset = true;
      candidates = candidatesFor(themeId);
    }

    var civil, under;

    if (level.mix && candidates.length > 1) {
      // Deux mots venus de deux paires différentes : aucun lien entre eux.
      var first = candidates[randomInt(candidates.length)];
      var rest = candidates.filter(function (ref) {
        return ref.themeId !== first.themeId || ref.index !== first.index;
      });
      var second = rest[randomInt(rest.length)];
      civil = sideOf(pairOf(first), Math.random() < 0.5, first);
      under = sideOf(pairOf(second), Math.random() < 0.5, second);
      markPlayed(first.themeId, first.index);
      markPlayed(second.themeId, second.index);
    } else {
      var pick = filterByProximity(candidates, level.scores);
      var ref = pick[randomInt(pick.length)];
      var pair = pairOf(ref);
      markPlayed(ref.themeId, ref.index);
      // Le mot des civils est tiré au hasard dans la paire (50/50).
      var flipped = Math.random() < 0.5;
      civil = sideOf(pair, flipped, ref);
      under = sideOf(pair, !flipped, ref);
    }

    return { words: { civil: civil, under: under }, reset: didReset };
  }

  function randomInt(max) {
    if (window.crypto && window.crypto.getRandomValues && max > 0) {
      var limit = Math.floor(0xffffffff / max) * max;
      var buffer = new Uint32Array(1);
      var value;
      do {
        window.crypto.getRandomValues(buffer);
        value = buffer[0];
      } while (value >= limit);
      return value % max;
    }
    return Math.floor(Math.random() * max);
  }

  function shuffle(array) {
    var copy = array.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = randomInt(i + 1);
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  /* ----------------------------------------------------------- Navigation */

  var screens = {
    home: document.getElementById('screen-home'),
    config: document.getElementById('screen-config'),
    pass: document.getElementById('screen-pass'),
    reveal: document.getElementById('screen-reveal'),
    end: document.getElementById('screen-end'),
    bots: document.getElementById('screen-bots')
  };

  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].classList.toggle('is-active', key === name);
    });
    currentScreen = name;
    var body = screens[name].querySelector('.screen-body');
    if (body) body.scrollTop = 0;
  }

  /**
   * Neutralise le bouton retour du navigateur pendant la distribution :
   * un état sentinelle est réempilé à chaque tentative de retour.
   */
  function armBackGuard() {
    if (backGuardArmed) return;
    backGuardArmed = true;
    history.pushState({ guard: true }, '');
  }

  function disarmBackGuard() {
    backGuardArmed = false;
  }

  window.addEventListener('popstate', function () {
    if (backGuardArmed) history.pushState({ guard: true }, '');
  });

  /* ------------------------------------------------------------ Retours UI */

  var toastEl = document.getElementById('toast');
  var toastTimer = null;

  function toast(message) {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.hidden = false;
    // Force un reflow pour rejouer la transition.
    void toastEl.offsetWidth;
    toastEl.classList.add('is-visible');
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-visible');
      toastTimer = setTimeout(function () { toastEl.hidden = true; }, 300);
    }, 3200);
  }

  function buzz(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (err) { /* ignoré */ }
    }
  }

  /* ---------------------------------------------- Écran de configuration */

  var playersCountEl = document.getElementById('players-count');
  var botsCountEl = document.getElementById('bots-count');
  var botsHintEl = document.getElementById('bots-hint');
  var undercoverCountEl = document.getElementById('undercover-count');
  var undercoverHintEl = document.getElementById('undercover-hint');
  var playersListEl = document.getElementById('players-list');
  var themeSelectEl = document.getElementById('theme-select');
  var proxRangeEl = document.getElementById('prox-range');
  var proxLabelEl = document.getElementById('prox-label');
  var proxHintEl = document.getElementById('prox-hint');
  var optKnowRoleEl = document.getElementById('opt-know-role');
  var optKnowAlliesEl = document.getElementById('opt-know-allies');

  function fillThemeSelect() {
    var options = ['<option value="' + ALL_THEMES + '">Tout (toutes thématiques)</option>'];
    WORD_BANK.forEach(function (theme) {
      options.push('<option value="' + theme.id + '">' + escapeHtml(theme.name) + '</option>');
    });
    themeSelectEl.innerHTML = options.join('');
  }

  function renderConfig() {
    playersCountEl.textContent = config.playerCount;
    botsCountEl.textContent = config.botCount;
    undercoverCountEl.textContent = config.undercoverCount;
    undercoverHintEl.textContent = 'max. ' + maxUndercovers(totalPlayers());
    botsHintEl.textContent = config.botCount > 0
      ? totalPlayers() + ' joueurs en tout'
      : 'joueurs tenus par l\'app';

    document.querySelectorAll('[data-step]').forEach(function (btn) {
      var kind = btn.getAttribute('data-step');
      var delta = parseInt(btn.getAttribute('data-delta'), 10);
      if (kind === 'players') {
        btn.disabled = delta < 0 ? config.playerCount <= minHumans() : config.playerCount >= MAX_PLAYERS;
      } else if (kind === 'bots') {
        btn.disabled = delta < 0
          ? config.botCount <= 0
          : config.botCount >= MAX_BOTS || totalPlayers() >= MAX_PLAYERS;
      } else {
        btn.disabled = delta < 0
          ? config.undercoverCount <= 1
          : config.undercoverCount >= maxUndercovers(totalPlayers());
      }
    });

    renderPlayerRows();
    themeSelectEl.value = config.themeId;
    proxRangeEl.value = config.proximity;
    renderProximity();
    optKnowRoleEl.checked = config.knowRole;
    optKnowAlliesEl.checked = config.knowAllies;
  }

  function renderProximity() {
    var level = proximityLevel(config.proximity);
    proxLabelEl.textContent = level.name;
    proxHintEl.textContent = level.hint;
  }

  function renderPlayerRows() {
    // Ne reconstruit la liste que si le nombre de lignes a changé,
    // pour ne pas voler le focus pendant la saisie d'un nom.
    if (playersListEl.childElementCount !== config.playerCount + config.botCount) {
      var html = '';
      for (var i = 0; i < config.playerCount; i++) {
        html += '<div class="player-row">' +
                  '<span class="player-num">' + (i + 1) + '</span>' +
                  '<input class="player-input" type="text" inputmode="text" autocomplete="off" ' +
                    'autocapitalize="words" spellcheck="false" maxlength="18" data-player="' + i + '" ' +
                    'aria-label="Nom du joueur ' + (i + 1) + '" placeholder="' + defaultName(i) + '">' +
                '</div>';
      }
      for (var b = 0; b < config.botCount; b++) {
        html += '<div class="player-row is-bot">' +
                  '<span class="player-num">' + (config.playerCount + b + 1) + '</span>' +
                  '<span class="player-bot-name">' + botName(b) + '</span>' +
                  '<span class="player-bot-tag">ROBOT</span>' +
                '</div>';
      }
      playersListEl.innerHTML = html;
    }
    playersListEl.querySelectorAll('.player-input').forEach(function (input) {
      var index = parseInt(input.getAttribute('data-player'), 10);
      if (document.activeElement !== input) input.value = config.names[index] || '';
    });
  }

  function setBotCount(count) {
    count = clamp(count, 0, Math.min(MAX_BOTS, MAX_PLAYERS - config.playerCount));
    config.botCount = count;
    // Sans robot, il faut de nouveau trois humains autour de la table.
    config.playerCount = Math.max(config.playerCount, minHumans());
    config.names = buildDefaultNames(config.playerCount, config.names);
    config.undercoverCount = clamp(config.undercoverCount, 1, maxUndercovers(totalPlayers()));
    renderConfig();
  }

  function setPlayerCount(count) {
    count = clamp(count, minHumans(), MAX_PLAYERS - config.botCount);
    if (count === config.playerCount) return;

    var names = config.names.slice();
    if (count > names.length) {
      for (var i = names.length; i < count; i++) names.push(defaultName(i));
    } else {
      names = names.slice(0, count);
    }
    config.names = names;
    config.playerCount = count;
    // Réajustement automatique du nombre d'undercovers.
    config.undercoverCount = clamp(config.undercoverCount, 1, maxUndercovers(totalPlayers()));
    renderConfig();
  }

  function setUndercoverCount(count) {
    config.undercoverCount = clamp(count, 1, maxUndercovers(totalPlayers()));
    renderConfig();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  // Saisie des noms : un nom vide retombe sur le nom par défaut.
  playersListEl.addEventListener('input', function (event) {
    var input = event.target.closest('.player-input');
    if (!input) return;
    var index = parseInt(input.getAttribute('data-player'), 10);
    config.names[index] = input.value;
  });

  playersListEl.addEventListener('focusout', function (event) {
    var input = event.target.closest('.player-input');
    if (!input) return;
    var index = parseInt(input.getAttribute('data-player'), 10);
    if (!input.value.trim()) {
      config.names[index] = defaultName(index);
      input.value = '';
    }
  });

  playersListEl.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') event.target.blur();
  });

  document.querySelectorAll('[data-step]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var delta = parseInt(btn.getAttribute('data-delta'), 10);
      var kind = btn.getAttribute('data-step');
      if (kind === 'players') setPlayerCount(config.playerCount + delta);
      else if (kind === 'bots') setBotCount(config.botCount + delta);
      else setUndercoverCount(config.undercoverCount + delta);
      buzz(8);
    });
  });

  themeSelectEl.addEventListener('change', function () {
    config.themeId = themeSelectEl.value;
  });

  proxRangeEl.addEventListener('input', function () {
    config.proximity = parseInt(proxRangeEl.value, 10);
    renderProximity();
  });

  optKnowRoleEl.addEventListener('change', function () {
    config.knowRole = optKnowRoleEl.checked;
  });

  optKnowAlliesEl.addEventListener('change', function () {
    config.knowAllies = optKnowAlliesEl.checked;
  });

  function resolvedNames() {
    return config.names.map(function (name, index) {
      var trimmed = (name || '').trim();
      return trimmed || defaultName(index);
    });
  }

  /* --------------------------------------------------------- Distribution */

  function startDistribution(useExistingConfig) {
    if (!useExistingConfig) config.names = resolvedNames();

    var participants = buildParticipants();
    var draw = drawPair(config.themeId, config.proximity);

    // Les robots participent au tirage des rôles comme les humains.
    var order = shuffle(participants.map(function (_, index) { return index; }));
    var undercovers = order.slice(0, config.undercoverCount);

    game = {
      participants: participants,
      humans: participants.reduce(function (acc, p, index) {
        if (!p.bot) acc.push(index);
        return acc;
      }, []),
      words: draw.words,
      undercovers: undercovers,
      knowRole: config.knowRole || config.knowAllies,
      knowAllies: config.knowAllies,
      showCivilRole: config.knowRole,
      cursor: 0,
      round: 1,
      clues: {},
      usedClues: [],
      eliminated: {}
    };

    armBackGuard();
    showPass();

    if (draw.reset) {
      toast(config.themeId === ALL_THEMES
        ? 'Toutes les paires ont été jouées, on repart de zéro !'
        : 'Thématique terminée, on repart de zéro !');
    }
  }

  var passProgressEl = document.getElementById('pass-progress');
  var passNameEl = document.getElementById('pass-name');

  function showPass() {
    passProgressEl.textContent = 'Joueur ' + (game.cursor + 1) + ' / ' + game.humans.length;
    passNameEl.textContent = game.participants[game.humans[game.cursor]].name;
    showScreen('pass');
  }

  var revealNameEl = document.getElementById('reveal-name');
  var wordFrEl = document.getElementById('word-fr');
  var wordEnEl = document.getElementById('word-en');
  var wordZhEl = document.getElementById('word-zh');
  var roleBadgeEl = document.getElementById('role-badge');
  var roleMarkEl = document.getElementById('role-mark');
  var alliesEl = document.getElementById('allies');
  var alliesNamesEl = document.getElementById('allies-names');
  var wordcardEl = document.getElementById('wordcard');

  function showReveal() {
    var index = game.humans[game.cursor];
    var isUndercover = game.undercovers.indexOf(index) !== -1;
    var words = isUndercover ? game.words.under : game.words.civil;

    revealNameEl.textContent = game.participants[index].name;
    wordFrEl.textContent = words.fr;
    wordEnEl.textContent = words.en;
    wordZhEl.textContent = words.zh;

    // Badge de rôle : toujours pour un undercover si l'option est active,
    // « CIVIL » seulement si l'option « savent qu'ils le sont » est cochée.
    var showBadge = isUndercover ? game.knowRole : game.showCivilRole;
    roleBadgeEl.hidden = !showBadge;
    roleMarkEl.hidden = !showBadge;
    if (showBadge) {
      roleBadgeEl.textContent = isUndercover ? 'UNDERCOVER' : 'CIVIL';
      roleBadgeEl.classList.toggle('is-under', isUndercover);
      roleBadgeEl.classList.toggle('is-civil', !isUndercover);
      roleMarkEl.src = isUndercover ? 'icons/logo-undercover.png' : 'icons/logo-civil.png';
      roleMarkEl.classList.toggle('is-under', isUndercover);
      roleMarkEl.classList.toggle('is-civil', !isUndercover);
    }

    // Les robots undercovers comptent comme complices.
    var allies = game.undercovers
      .filter(function (i) { return i !== index; })
      .map(function (i) { return game.participants[i].name; });
    var showAllies = game.knowAllies && isUndercover && allies.length > 0;
    alliesEl.hidden = !showAllies;
    if (showAllies) alliesNamesEl.textContent = allies.join(', ');

    // Rejoue l'animation de retournement de carte.
    var inner = wordcardEl.querySelector('.wordcard-inner');
    inner.style.animation = 'none';
    void inner.offsetWidth;
    inner.style.animation = '';

    showScreen('reveal');
    buzz(14);
  }

  function hideWord() {
    // Efface le mot avant même de changer d'écran.
    wordFrEl.textContent = '';
    wordEnEl.textContent = '';
    wordZhEl.textContent = '';
    alliesNamesEl.textContent = '';
    roleBadgeEl.hidden = true;
    roleMarkEl.hidden = true;
    alliesEl.hidden = true;

    game.cursor++;
    if (game.cursor >= game.humans.length) {
      disarmBackGuard();
      showEnd();
      buzz([12, 60, 12]);
    } else {
      showPass();
    }
  }

  /* --------------------------------------------------- Installation PWA */

  var installBtnEl = document.getElementById('install-btn');
  var installEvent = null;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           navigator.standalone === true;
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
           // iPadOS 13+ se présente comme un Mac tactile.
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function refreshInstallButton() {
    // Le bouton n'a de sens que hors application déjà installée.
    installBtnEl.hidden = isStandalone();
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    // Empêche la mini-bannière Chrome : on propose l'installation nous-mêmes.
    event.preventDefault();
    installEvent = event;
    refreshInstallButton();
  });

  window.addEventListener('appinstalled', function () {
    installEvent = null;
    installBtnEl.hidden = true;
    toast('Undercover est installé sur ton écran d\'accueil.');
  });

  var IOS_INSTALL_HTML =
    '<p>Sur iPhone et iPad, l\'installation passe par Safari :</p>' +
    '<ol>' +
      '<li>Touche le bouton <strong>Partager</strong> (le carré avec une flèche vers le haut), en bas de l\'écran.</li>' +
      '<li>Fais défiler puis choisis <strong>« Sur l\'écran d\'accueil »</strong>.</li>' +
      '<li>Valide avec <strong>Ajouter</strong>.</li>' +
    '</ol>' +
    '<p>L\'icône du raton laveur apparaît alors avec tes autres applications, et le jeu fonctionne sans connexion.</p>';

  var GENERIC_INSTALL_HTML =
    '<p>Pour garder le jeu sous la main :</p>' +
    '<ol>' +
      '<li>Ouvre le menu de ton navigateur (les trois points).</li>' +
      '<li>Choisis <strong>« Installer l\'application »</strong> ou <strong>« Ajouter à l\'écran d\'accueil »</strong>.</li>' +
    '</ol>' +
    '<p>Une fois installé, le jeu fonctionne sans connexion.</p>';

  function promptInstall() {
    if (installEvent) {
      installEvent.prompt();
      installEvent.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') installBtnEl.hidden = true;
        installEvent = null;
      });
      return;
    }
    openSheet('Installer le jeu', isIOS() ? IOS_INSTALL_HTML : GENERIC_INSTALL_HTML);
  }

  /* --------------------------------------------------- Tour des robots */

  var botsTurnBtnEl = document.getElementById('bots-turn-btn');
  var botsRoundEl = document.getElementById('bots-round');
  var botsListEl = document.getElementById('bots-list');

  var BOT_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<rect x="4" y="8" width="16" height="12" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<circle cx="9.5" cy="14" r="1.5" fill="currentColor"/>' +
    '<circle cx="14.5" cy="14" r="1.5" fill="currentColor"/>' +
    '<path d="M12 8V4M9 4h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '</svg>';

  function showEnd() {
    botsTurnBtnEl.hidden = !game || !game.participants.some(function (p) { return p.bot; });
    showScreen('end');
  }

  /**
   * Indice donné par un robot. Les paires voisines dans la banque relèvent de
   * la même famille de mots : on y pioche un mot du même univers que celui du
   * robot, sans jamais reprendre l'un des deux mots de la partie.
   */
  function pickClue(ref) {
    var forbidden = [game.words.civil.fr, game.words.under.fr];
    var theme = ref ? themeById(ref.themeId) : WORD_BANK[randomInt(WORD_BANK.length)];
    var count = theme.pairs.length;
    var origin = ref ? ref.index : randomInt(count);
    var pool = [];

    for (var d = 1; d <= 3; d++) {
      [(origin - d + count) % count, (origin + d) % count].forEach(function (index) {
        var pair = theme.pairs[index];
        pool.push(pair[0], pair[1]);
      });
    }

    var fresh = pool.filter(function (word) {
      return forbidden.indexOf(word) === -1 && game.usedClues.indexOf(word) === -1;
    });
    var usable = fresh.length ? fresh : pool.filter(function (word) {
      return forbidden.indexOf(word) === -1;
    });
    var clue = usable[randomInt(usable.length)];
    game.usedClues.push(clue);
    return clue;
  }

  function clueFor(index) {
    var key = index + ':' + game.round;
    if (!game.clues[key]) {
      var isUndercover = game.undercovers.indexOf(index) !== -1;
      var words = isUndercover ? game.words.under : game.words.civil;
      game.clues[key] = pickClue(words.ref);
    }
    return game.clues[key];
  }

  function renderBots() {
    botsRoundEl.textContent = 'Tour ' + game.round;
    var html = '';
    game.participants.forEach(function (participant, index) {
      if (!participant.bot) return;
      var said = game.clues[index + ':' + game.round];
      var out = game.eliminated[index];
      var wasUndercover = game.undercovers.indexOf(index) !== -1;

      html += '<div class="bot-row' + (out ? ' is-out' : '') + '">' +
                '<span class="bot-avatar">' + BOT_ICON + '</span>' +
                '<span class="bot-text">' +
                  '<span class="bot-name">' + escapeHtml(participant.name) + '</span>' +
                  (out
                    ? '<span class="bot-verdict ' + (wasUndercover ? 'is-under' : 'is-civil') + '">' +
                      (wasUndercover ? 'C\'était un UNDERCOVER' : 'C\'était un CIVIL') + '</span>'
                    : said
                      ? '<span class="bot-clue">' + escapeHtml(said) + '</span>'
                      : '<span class="bot-waiting">n\'a pas encore parlé</span>') +
                '</span>' +
                (out ? '' :
                  '<span class="bot-actions">' +
                    (said ? '' :
                      '<button class="btn btn-secondary bot-btn" data-action="bot-clue" data-bot="' +
                      index + '">Faire parler</button>') +
                    '<button class="btn btn-ghost bot-btn bot-out" data-action="bot-eliminate" data-bot="' +
                    index + '">Éliminer</button>' +
                  '</span>') +
              '</div>';
    });
    botsListEl.innerHTML = html;
  }

  function openBots() {
    renderBots();
    showScreen('bots');
  }

  /* ------------------------------------------------------------- Modales */

  var sheetEl = document.getElementById('sheet');
  var sheetTitleEl = document.getElementById('sheet-title');
  var sheetContentEl = document.getElementById('sheet-content');

  var RULES_HTML =
    '<p>Cette application ne fait qu\'une chose : <strong>distribuer les mots en secret</strong>. ' +
    'Les débats, les votes et les éliminations se jouent à l\'oral, entre vous.</p>' +
    '<ol>' +
      '<li>Réglez le nombre de joueurs et d\'undercovers, puis lancez la partie.</li>' +
      '<li>Le téléphone tourne : chacun découvre son mot, seul, puis le masque.</li>' +
      '<li>Les civils ont tous le même mot. Les undercovers ont l\'autre mot de la paire.</li>' +
      '<li>Chacun décrit son mot avec <strong>un seul mot</strong>, à tour de rôle, sans le prononcer.</li>' +
      '<li>Après chaque tour, tout le monde vote et élimine un joueur.</li>' +
      '<li>Si des robots jouent, l\'écran de fin permet de les faire parler à chaque tour, et de les éliminer pour découvrir leur rôle.</li>' +
      '<li>Les civils gagnent s\'ils éliminent tous les undercovers ; les undercovers gagnent s\'ils survivent jusqu\'à l\'égalité.</li>' +
    '</ol>' +
    '<p>Une paire de mots n\'est jamais tirée deux fois tant que la thématique n\'est pas épuisée.</p>';

  function aboutHtml() {
    return '<p><strong>Undercover</strong> — version ' + VERSION + '</p>' +
      '<p>Application 100 % hors-ligne : aucune donnée n\'est envoyée, aucun compte, aucun serveur. ' +
      'Seule la liste des paires déjà jouées est conservée sur ce téléphone.</p>' +
      '<p>Banque de mots trilingue français / anglais / 中文, répartie en ' +
      WORD_BANK.length + ' thématiques. ' +
      'Une paire jouée ne ressort pas tant que la thématique n\'est pas épuisée.</p>' +
      '<p><button class="btn btn-secondary" data-action="reset-history" style="width:100%">' +
      'Réinitialiser l\'historique des paires</button></p>';
  }

  function openSheet(title, html) {
    sheetTitleEl.textContent = title;
    sheetContentEl.innerHTML = html;
    sheetEl.hidden = false;
  }

  function closeSheet() {
    sheetEl.hidden = true;
  }

  sheetEl.addEventListener('click', function (event) {
    if (event.target === sheetEl) closeSheet();
  });

  /* ------------------------------------------------------------- Actions */

  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-action]');
    if (!trigger) return;

    switch (trigger.getAttribute('data-action')) {
      case 'new-game':
        config = defaultConfig();
        fillThemeSelect();
        renderConfig();
        showScreen('config');
        break;

      case 'config-back':
        config = null;
        showScreen('home');
        break;

      case 'start-game':
        config.names = resolvedNames();
        startDistribution(false);
        break;

      case 'reveal':
        showReveal();
        break;

      case 'hide-word':
        hideWord();
        break;

      case 'replay':
        // Mêmes paramètres, nouvelle paire, nouvelle répartition des rôles.
        startDistribution(true);
        break;

      case 'edit-settings':
        renderConfig();
        showScreen('config');
        break;

      case 'go-home':
        // Les paramètres de session sont perdus, l'historique des paires est conservé.
        config = null;
        game = null;
        showScreen('home');
        break;

      case 'install':
        promptInstall();
        break;

      case 'open-bots':
        openBots();
        break;

      case 'bots-back':
        showEnd();
        break;

      case 'bot-clue':
        clueFor(parseInt(trigger.getAttribute('data-bot'), 10));
        renderBots();
        buzz(10);
        break;

      case 'bot-eliminate':
        // Révèle le rôle du robot : c'est tout l'intérêt du vote contre lui.
        var eliminated = parseInt(trigger.getAttribute('data-bot'), 10);
        game.eliminated[eliminated] = true;
        renderBots();
        buzz(game.undercovers.indexOf(eliminated) !== -1 ? [14, 70, 14] : 18);
        break;

      case 'bots-next-round':
        game.round++;
        renderBots();
        break;

      case 'open-rules':
        openSheet('Comment on joue', RULES_HTML);
        break;

      case 'open-about':
        openSheet('À propos', aboutHtml());
        break;

      case 'reset-history':
        resetAllThemes();
        closeSheet();
        toast('Historique des paires réinitialisé.');
        break;

      case 'close-sheet':
        closeSheet();
        break;
    }
  });

  /* --------------------------------------------------------- Démarrage */

  document.getElementById('version-label').textContent = VERSION;
  refreshInstallButton();
  fillThemeSelect();
  showScreen('home');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* hors-ligne indisponible */ });
    });
  }
})();
