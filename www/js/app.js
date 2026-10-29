(function (global) {
/** クリックで処理する data-action（チェックボックス等の change 系は除外） */
const CLICK_ACTIONS = new Set([
  'clear-checks',
  'reset-today',
  'manual-save',
  'sort-cars',
  'toggle-car-sort',
  'sort-grade',
  'sort-name',
  'promote',
  'add-car',
  'add-child',
  'generate',
  'copy-result',
  'print-plan',
  'reset-data',
  'copy-backup',
  'open-restore',
  'close-restore',
  'apply-restore',
  'toggle-settings',
  'close-modal',
  'save-child',
  'delete-car',
  'move-car-up',
  'move-car-down',
  'edit-child',
  'delete-child',
  'add-companion',
  'add-companion-custom',
  'remove-companion',
  'add-child-companion',
  'remove-child-companion',
  'toggle-role-master',
  'switch-master-tab',
  'add-role',
  'delete-role',
  'add-care-tag',
  'delete-care-tag',
  'toggle-care-pill',
  'toggle-day-status',
  'set-service-weekday',
  'toggle-schedule-day',
  'add-driver-role',
  'remove-driver-role',
  'add-companion-role',
  'remove-companion-role',
  'reset-role-labels',
  'toggle-section',
  'open-child-companion',
  'open-tutorial',
  'toggle-place-picker',
  'search-place',
  'search-facility',
  'save-facility',
  'close-tutorial',
  'tutorial-next',
  'tutorial-prev',
  'tutorial-goto'
]);

/** touchend 直後の合成 click を無視するためのフラグ */
let suppressNextClick = false;

function findActionEl(eventTarget) {
  if (!eventTarget || typeof eventTarget.closest !== 'function') return null;
  return eventTarget.closest('[data-action]');
}

function isDisabledControl(el) {
  if (!el) return true;
  if (el.disabled) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  return false;
}

function runClickAction(target) {
  if (!target || isDisabledControl(target)) return;

  const action = target.dataset.action;
  if (!CLICK_ACTIONS.has(action)) return;

  const id = Number(target.dataset.id);
  switch (action) {
    case 'clear-checks':
      clearAllChecks();
      break;
    case 'reset-today':
      resetTodaySession();
      break;
    case 'manual-save':
      manualSave();
      break;
    case 'sort-cars':
      toggleCarSortMode();
      break;
    case 'toggle-car-sort':
      toggleCarSortMode();
      break;
    case 'sort-grade':
      setChildSortMode('grade');
      break;
    case 'sort-name':
      setChildSortMode('kana');
      break;
    case 'promote':
      promoteAllGrades();
      break;
    case 'add-car':
      addCar();
      break;
    case 'add-child':
      addChild();
      break;
    case 'generate':
      runDispatchWithRoute();
      break;
    case 'copy-result':
      copyResult();
      break;
    case 'print-plan':
      printDispatchSheet();
      break;
    case 'reset-data':
      resetAllData();
      break;
    case 'copy-backup':
      copyBackupData();
      break;
    case 'open-restore':
      openRestoreModal();
      break;
    case 'close-restore':
      closeRestoreModal();
      break;
    case 'apply-restore':
      applyRestore();
      break;
    case 'close-modal':
      closeEditModal();
      break;
    case 'save-child':
      saveEditChild();
      break;
    case 'delete-car':
      deleteCar(id);
      break;
    case 'move-car-up':
      moveCar(id, 'up');
      break;
    case 'move-car-down':
      moveCar(id, 'down');
      break;
    case 'edit-child':
      openEditModal(id);
      break;
    case 'delete-child':
      deleteChild(id);
      break;
    case 'add-companion':
      addCompanion(id, target.dataset.label || '');
      break;
    case 'add-companion-custom':
      addCompanionCustom(id);
      break;
    case 'remove-companion': {
      const carId = Number(target.dataset.carId);
      const companionId = target.dataset.companionId;
      removeCompanion(carId, companionId);
      break;
    }
    case 'add-child-companion':
      if (target.dataset.label) addChildCompanion(id, target.dataset.label);
      else addChildCompanionCustom(id);
      break;
    case 'remove-child-companion': {
      const childId = Number(target.dataset.childId);
      const companionId = target.dataset.companionId;
      removeChildCompanion(childId, companionId);
      break;
    }
    case 'toggle-section':
      toggleSection(target.dataset.section || '');
      break;
    case 'toggle-settings':
      toggleSettingsPanel();
      break;
    case 'open-child-companion':
      openChildCompanionEditor(id);
      break;
    case 'open-tutorial':
      openTutorialModal({ reset: true });
      break;
    case 'toggle-place-picker':
      togglePlacePicker(target.dataset.scope || 'edit');
      break;
    case 'search-place':
      searchPlace(target.dataset.scope || 'edit');
      break;
    case 'search-facility':
      searchFacilityPlace();
      break;
    case 'save-facility':
      saveFacilityPlace();
      break;
    case 'toggle-role-master':
      toggleRoleMaster();
      break;
    case 'switch-master-tab':
      switchMasterTab(target.dataset.tab || 'roles');
      break;
    case 'add-role':
      addRoleFromInput();
      break;
    case 'delete-role':
      deleteRole(target.dataset.roleId || '');
      break;
    case 'add-care-tag':
      addCareTagFromInput();
      break;
    case 'delete-care-tag':
      deleteCareTag(target.dataset.tagId || '');
      break;
    case 'toggle-care-pill':
      toggleCarePill(target.dataset.scope || 'new', target.dataset.tagId || '');
      break;
    case 'toggle-day-status':
      togglePassengerDayStatus(target.dataset.id || '');
      break;
    case 'set-service-weekday':
      setServiceWeekday(target.dataset.day || '');
      break;
    case 'toggle-schedule-day':
      toggleScheduleDay(target.dataset.scope || 'new', target.dataset.day || '');
      break;
    case 'add-driver-role':
      addDriverRoleFromInput();
      break;
    case 'remove-driver-role':
      removeDriverRole(target.dataset.label || '');
      break;
    case 'add-companion-role':
      addCompanionRoleFromInput();
      break;
    case 'remove-companion-role':
      removeCompanionRole(target.dataset.label || '');
      break;
    case 'reset-role-labels':
      resetRoleLabelsToDefault();
      break;
    case 'close-tutorial':
      closeTutorialModal();
      break;
    case 'tutorial-next':
      tutorialNext();
      break;
    case 'tutorial-prev':
      tutorialPrev();
      break;
    case 'tutorial-goto':
      tutorialGoto(target.dataset.slide);
      break;
    default:
      break;
  }
}

function handleAppClick(event) {
  if (suppressNextClick) {
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  const target = findActionEl(event.target);
  if (!target) return;
  // input/select は change / input に任せる
  if (target.matches('input, select, textarea')) return;

  runClickAction(target);
}

/** iOS のみ touchend 合成クリックが必要。Android WebView では preventDefault が縦スクロールを阻害する */
function needsIosTouchClickFallback() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return false;
  if (/iP(hone|od|ad)/i.test(ua)) return true;
  // iPadOS 13+（Mac 表記だがタッチ端末）
  if (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1) return true;
  return false;
}

/**
 * iOS Safari / ホーム画面PWA 向け:
 * 一部環境で click が欠落するため、ボタン系は touchend でも発火させる。
 * preventDefault で後続の合成 click を抑止し二重実行を防ぐ。
 * ※ Android では登録しない（縦スクロール阻害防止）。
 */
function handleAppTouchEnd(event) {
  if (event.touches && event.touches.length > 0) return; // マルチタッチ中は無視
  if (event.changedTouches && event.changedTouches.length > 1) return;

  const target = findActionEl(event.target);
  if (!target) return;
  if (target.matches('input, select, textarea, label')) return;
  if (!CLICK_ACTIONS.has(target.dataset.action)) return;
  if (isDisabledControl(target)) return;

  // スクロール直後の誤タップは無視（小さな移動は許容）
  const touch = event.changedTouches && event.changedTouches[0];
  if (touch && target._touchStartY != null) {
    const dy = Math.abs(touch.clientY - target._touchStartY);
    if (dy > 12) return;
  }
  if (target._touchMoved) return;

  suppressNextClick = true;
  event.preventDefault();
  runClickAction(target);
}

function handleAppTouchStart(event) {
  const target = findActionEl(event.target);
  if (!target || !event.touches || !event.touches[0]) return;
  target._touchStartY = event.touches[0].clientY;
  target._touchMoved = false;
}

function handleAppTouchMove(event) {
  if (!event.touches || !event.touches[0]) return;
  const target = findActionEl(event.target);
  if (!target || target._touchStartY == null) return;
  const dy = Math.abs(event.touches[0].clientY - target._touchStartY);
  if (dy > 12) target._touchMoved = true;
}

function handleAppChange(event) {
  const target = findActionEl(event.target);
  if (!target) return;

  const id = Number(target.dataset.id);
  switch (target.dataset.action) {
    case 'toggle-car':
      // ネイティブの checked を正とする（トグル二重反転を防ぐ）
      toggleCar(id, target.checked);
      break;
    case 'update-capacity':
      updateCapacity(id, target.value);
      break;
    case 'rename-car':
      commitCarRename(id, target.value);
      break;
    case 'toggle-equipment': {
      const carId = Number(target.dataset.carId || target.dataset.id);
      toggleEquipmentCar(carId, target.checked);
      break;
    }
    case 'change-child-sort':
      setChildSortMode(target.value);
      break;
    case 'set-attend':
      setChildAttend(id, target.value);
      break;
    case 'set-fixed-car':
      setChildFixedCar(id, target.value);
      break;
    case 'set-dispatch-period':
      setDispatchPeriod(target.value);
      renderCars();
      break;
    case 'set-car-driver':
      setCarDriverRole(target.dataset.carId || target.dataset.id, target.value);
      break;
    case 'set-car-assistant':
      setCarAssistantRole(target.dataset.carId || target.dataset.id, target.value);
      break;
    case 'rename-role':
      renameRole(target.dataset.roleId || '', target.value);
      break;
    case 'edit-role-color':
      editRoleColor(target.dataset.roleId || '', target.value);
      break;
    case 'toggle-role-driver':
      toggleRoleFlag(target.dataset.roleId || '', 'isDriver', target.checked);
      break;
    case 'toggle-role-assistant':
      toggleRoleFlag(target.dataset.roleId || '', 'isAssistant', target.checked);
      break;
    case 'rename-care-tag':
      renameCareTag(target.dataset.tagId || '', target.value);
      break;
    case 'edit-care-tag-color':
      editCareTagColor(target.dataset.tagId || '', target.value);
      break;
    case 'toggle-care-tag-disperse':
      toggleCareTagDisperse(target.dataset.tagId || '', target.checked);
      break;
    case 'toggle-motion-sick':
      syncMotionSickPills(target.dataset.scope || 'new', target.checked);
      break;
    case 'set-service-date':
      setServiceDate(target.value);
      break;
    case 'set-departure-time':
      setDepartureTime(target.value);
      break;
    case 'set-facility-name':
      setFacilityName(target.value);
      break;
    case 'set-facility-coord':
      setFacilityCoord(target.dataset.coord || '', target.value);
      break;
    default:
      break;
  }
}

function initApp() {
  // document へ委任（再描画後も確実に拾う）
  document.addEventListener('click', handleAppClick);
  document.addEventListener('change', handleAppChange);
  // touchend + preventDefault は iOS のみ（Android WebView の縦スクロールを壊さない）
  if (needsIosTouchClickFallback()) {
    document.addEventListener('touchstart', handleAppTouchStart, { passive: true });
    document.addEventListener('touchmove', handleAppTouchMove, { passive: true });
    document.addEventListener('touchend', handleAppTouchEnd, { passive: false });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;

    const newRoleName = event.target.closest('#newRoleName');
    if (newRoleName) {
      event.preventDefault();
      addRoleFromInput();
      return;
    }

    const newCareTagName = event.target.closest('#newCareTagName');
    if (newCareTagName) {
      event.preventDefault();
      addCareTagFromInput();
      return;
    }

    const carInput = event.target.closest('.companion-input');
    if (carInput && carInput.id) {
      const carMatch = carInput.id.match(/^companionInput-(\d+)$/);
      if (carMatch) {
        event.preventDefault();
        addCompanionCustom(Number(carMatch[1]));
        return;
      }
    }

    const childInput = event.target.closest('.child-companion-input');
    if (childInput && childInput.id) {
      const childMatch = childInput.id.match(/^childCompanionInput-(\d+)$/);
      if (childMatch) {
        event.preventDefault();
        addChildCompanionCustom(Number(childMatch[1]));
      }
    }
  });

  applySectionOpenState();
  applySettingsPanelState();
  syncServiceDateBar();
  renderSchedulePills('new', WEEKDAY_KEYS.slice());
  syncFacilityInputs();
  // ソート状態を sessionStorage から復元（未エクスポート関数参照で init が落ちないよう HaishaUI 経由）
  HaishaUI.writeCarSortMode(HaishaUI.readCarSortMode());
  HaishaUI.writeChildSortMode(HaishaUI.readChildSortMode());
  renderCars();
  renderChildren();
  updateStatusBar();
  maybeShowTutorialOnLaunch();
}



  const HaishaApp = {
    init: initApp,
    runClickAction,
    handleAppClick,
    handleAppChange,
    handleAppTouchStart,
    handleAppTouchEnd,
    findActionEl,
    isDisabledControl,
    get CLICK_ACTIONS() { return CLICK_ACTIONS; }
  };
  global.HaishaApp = HaishaApp;

  global.initApp = initApp;
  global.runClickAction = runClickAction;
  global.handleAppClick = handleAppClick;
  global.handleAppChange = handleAppChange;
  global.handleAppTouchStart = handleAppTouchStart;
  global.handleAppTouchEnd = handleAppTouchEnd;
  global.findActionEl = findActionEl;
  global.isDisabledControl = isDisabledControl;

  // 起動
  initApp();

})(typeof window !== 'undefined' ? window : globalThis);
