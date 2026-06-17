/**
 * patch-leaflet.js
 * 
 * Suppresses Firefox deprecation warnings for MouseEvent.mozPressure
 * and MouseEvent.mozInputSource. These legacy properties were deprecated
 * in Firefox 65+ in favour of PointerEvent.pressure / .pointerType.
 * Leaflet's event handling triggers them on every mouse interaction,
 * flooding the console with harmless but noisy warnings.
 *
 * The fix overrides the deprecated getters on MouseEvent.prototype with
 * forward-compatible alternatives. This bypasses Firefox's native
 * deprecation-warning getter and returns the correct modern values.
 */
(function () {
  'use strict';

  if (typeof MouseEvent === 'undefined') return;

  var warned = false;

  function defineSafeGetter(proto, deprecatedProp, modernGetter) {
    try {
      Object.defineProperty(proto, deprecatedProp, {
        get: modernGetter,
        configurable: true,
        enumerable: false
      });
    } catch (e) {
      if (!warned) {
        warned = true;
        console.warn('[patch-leaflet] Could not patch ' + deprecatedProp + ':', e.message);
      }
    }
  }

  // mozPressure → PointerEvent.pressure (0 = not pressed, 0.5 = normal, 1 = fully pressed)
  defineSafeGetter(MouseEvent.prototype, 'mozPressure', function () {
    return typeof this.pressure === 'number' ? this.pressure : 0;
  });

  // mozInputSource → PointerEvent.pointerType (mapped to legacy enum)
  // Legacy: 1=mouse, 2=pen, 3=eraser, 4=cursor, 5=touch, 6=keyboard
  defineSafeGetter(MouseEvent.prototype, 'mozInputSource', function () {
    var pt = this.pointerType;
    if (pt === 'mouse') return 1;
    if (pt === 'pen')   return 2;
    if (pt === 'touch') return 5;
    // fallback: assume mouse
    return 1;
  });

})();
