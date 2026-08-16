/* ==========================================================================
   Undercover — logique applicative
   Vanilla JS, aucune dépendance. Tout est local (mémoire + localStorage).
   ========================================================================== */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var STORAGE_KEY = 'undercover.played.v1';

  var MIN_PLAYERS = 3;
  var MAX_PLAYERS = 20;
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
      undercoverCount: 1,
      names: buildDefaultNames(6, []),
      themeId: ALL_THEMES,
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

  function maxUndercovers(playerCount) {
    // Contrainte : strictement inférieur à la moitié des joueurs.
    return Math.max(1, Math.ceil(playerCount / 2) - 1);
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

  function totalPairs(themeId) {
    if (themeId === ALL_THEMES) {
      return WORD_BANK.reduce(function (sum, theme) { return sum + theme.pairs.length; }, 0);
    }
    var theme = themeById(themeId);
    return theme ? theme.pairs.length : 0;
  }

  function remainingPairs(themeId) {
    if (themeId === ALL_THEMES) {
      return WORD_BANK.reduce(function (sum, theme) {
        return sum + (theme.pairs.length - playedSet(theme.id).length);
      }, 0);
    }
    var theme = themeById(themeId);
    if (!theme) return 0;
    return theme.pairs.length - playedSet(theme.id).length;
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

  /**
   * Tire une paire non jouée. Réinitialise le périmètre concerné si épuisé.
   * @returns {{words: {civil: {fr: string, en: string}, under: {fr: string, en: string}}, reset: boolean}}
   */
  function drawPair(themeId) {
    var didReset = false;
    var candidates = candidatesFor(themeId);

    if (candidates.length === 0) {
      if (themeId === ALL_THEMES) resetAllThemes();
      else resetTheme(themeId);
      didReset = true;
      candidates = candidatesFor(themeId);
    }

    var pick = candidates[randomInt(candidates.length)];
    var theme = themeById(pick.themeId);
    var pair = theme.pairs[pick.index];
    markPlayed(pick.themeId, pick.index);

    // Le mot des civils est tiré au hasard dans la paire (50/50).
    var flipped = Math.random() < 0.5;
    var civil = flipped ? { fr: pair[1], en: pair[3] } : { fr: pair[0], en: pair[2] };
    var under = flipped ? { fr: pair[0], en: pair[2] } : { fr: pair[1], en: pair[3] };

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
    end: document.getElementById('screen-end')
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
  var undercoverCountEl = document.getElementById('undercover-count');
  var undercoverHintEl = document.getElementById('undercover-hint');
  var playersListEl = document.getElementById('players-list');
  var themeSelectEl = document.getElementById('theme-select');
  var remainingLabelEl = document.getElementById('remaining-label');
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
    undercoverCountEl.textContent = config.undercoverCount;
    undercoverHintEl.textContent = 'max. ' + maxUndercovers(config.playerCount);

    document.querySelectorAll('[data-step]').forEach(function (btn) {
      var kind = btn.getAttribute('data-step');
      var delta = parseInt(btn.getAttribute('data-delta'), 10);
      if (kind === 'players') {
        btn.disabled = delta < 0 ? config.playerCount <= MIN_PLAYERS : config.playerCount >= MAX_PLAYERS;
      } else {
        btn.disabled = delta < 0
          ? config.undercoverCount <= 1
          : config.undercoverCount >= maxUndercovers(config.playerCount);
      }
    });

    renderPlayerRows();
    themeSelectEl.value = config.themeId;
    renderRemaining();
    optKnowRoleEl.checked = config.knowRole;
    optKnowAlliesEl.checked = config.knowAllies;
  }

  function renderPlayerRows() {
    // Ne reconstruit la liste que si le nombre de lignes a changé,
    // pour ne pas voler le focus pendant la saisie d'un nom.
    if (playersListEl.childElementCount !== config.playerCount) {
      var html = '';
      for (var i = 0; i < config.playerCount; i++) {
        html += '<div class="player-row">' +
                  '<span class="player-num">' + (i + 1) + '</span>' +
                  '<input class="player-input" type="text" inputmode="text" autocomplete="off" ' +
                    'autocapitalize="words" spellcheck="false" maxlength="18" data-player="' + i + '" ' +
                    'aria-label="Nom du joueur ' + (i + 1) + '" placeholder="' + defaultName(i) + '">' +
                '</div>';
      }
      playersListEl.innerHTML = html;
    }
    playersListEl.querySelectorAll('.player-input').forEach(function (input) {
      var index = parseInt(input.getAttribute('data-player'), 10);
      if (document.activeElement !== input) input.value = config.names[index] || '';
    });
  }

  function renderRemaining() {
    var remaining = remainingPairs(config.themeId);
    var total = totalPairs(config.themeId);
    remainingLabelEl.textContent = remaining + ' / ' + total + ' paires restantes';
  }

  function setPlayerCount(count) {
    count = clamp(count, MIN_PLAYERS, MAX_PLAYERS);
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
    config.undercoverCount = clamp(config.undercoverCount, 1, maxUndercovers(count));
    renderConfig();
  }

  function setUndercoverCount(count) {
    config.undercoverCount = clamp(count, 1, maxUndercovers(config.playerCount));
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
      if (btn.getAttribute('data-step') === 'players') setPlayerCount(config.playerCount + delta);
      else setUndercoverCount(config.undercoverCount + delta);
      buzz(8);
    });
  });

  themeSelectEl.addEventListener('change', function () {
    config.themeId = themeSelectEl.value;
    renderRemaining();
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

    var names = resolvedNames();
    var draw = drawPair(config.themeId);

    var order = shuffle(names.map(function (_, index) { return index; }));
    var undercovers = order.slice(0, config.undercoverCount);

    game = {
      names: names,
      words: draw.words,
      undercovers: undercovers,
      knowRole: config.knowRole || config.knowAllies,
      knowAllies: config.knowAllies,
      showCivilRole: config.knowRole,
      cursor: 0
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
    passProgressEl.textContent = 'Joueur ' + (game.cursor + 1) + ' / ' + game.names.length;
    passNameEl.textContent = game.names[game.cursor];
    showScreen('pass');
  }

  var revealNameEl = document.getElementById('reveal-name');
  var wordFrEl = document.getElementById('word-fr');
  var wordEnEl = document.getElementById('word-en');
  var roleBadgeEl = document.getElementById('role-badge');
  var alliesEl = document.getElementById('allies');
  var alliesNamesEl = document.getElementById('allies-names');
  var wordcardEl = document.getElementById('wordcard');

  function showReveal() {
    var index = game.cursor;
    var isUndercover = game.undercovers.indexOf(index) !== -1;
    var words = isUndercover ? game.words.under : game.words.civil;

    revealNameEl.textContent = game.names[index];
    wordFrEl.textContent = words.fr;
    wordEnEl.textContent = words.en;

    // Badge de rôle : toujours pour un undercover si l'option est active,
    // « CIVIL » seulement si l'option « savent qu'ils le sont » est cochée.
    var showBadge = isUndercover ? game.knowRole : game.showCivilRole;
    roleBadgeEl.hidden = !showBadge;
    if (showBadge) {
      roleBadgeEl.textContent = isUndercover ? 'UNDERCOVER' : 'CIVIL';
      roleBadgeEl.classList.toggle('is-under', isUndercover);
      roleBadgeEl.classList.toggle('is-civil', !isUndercover);
    }

    var allies = game.undercovers
      .filter(function (i) { return i !== index; })
      .map(function (i) { return game.names[i]; });
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
    alliesNamesEl.textContent = '';
    roleBadgeEl.hidden = true;
    alliesEl.hidden = true;

    game.cursor++;
    if (game.cursor >= game.names.length) {
      disarmBackGuard();
      showScreen('end');
      buzz([12, 60, 12]);
    } else {
      showPass();
    }
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
      '<li>Les civils gagnent s\'ils éliminent tous les undercovers ; les undercovers gagnent s\'ils survivent jusqu\'à l\'égalité.</li>' +
    '</ol>' +
    '<p>Une paire de mots n\'est jamais tirée deux fois tant que la thématique n\'est pas épuisée.</p>';

  function aboutHtml() {
    var total = totalPairs(ALL_THEMES);
    var remaining = remainingPairs(ALL_THEMES);
    return '<p><strong>Undercover</strong> — version ' + VERSION + '</p>' +
      '<p>Application 100 % hors-ligne : aucune donnée n\'est envoyée, aucun compte, aucun serveur. ' +
      'Seule la liste des paires déjà jouées est conservée sur ce téléphone.</p>' +
      '<p>Banque de mots : <strong>' + total + ' paires</strong> bilingues FR/EN réparties en ' +
      WORD_BANK.length + ' thématiques.<br>Restantes non jouées : <strong>' + remaining + '</strong>.</p>' +
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

      case 'open-rules':
        openSheet('Comment on joue', RULES_HTML);
        break;

      case 'open-about':
        openSheet('À propos', aboutHtml());
        break;

      case 'reset-history':
        resetAllThemes();
        if (config) renderRemaining();
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
  fillThemeSelect();
  showScreen('home');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* hors-ligne indisponible */ });
    });
  }
})();
