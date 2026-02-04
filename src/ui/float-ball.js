/**
 * 悬浮球模块
 * @module ui/float-ball
 */

import Logger from '@core/logger';
import { isPluginEnabled, loadConfig } from '@config/config-manager';

// 悬浮球状态
let floatBall = null;
let floatBallCleanup = null;
let floatBallGuardCleanup = null;
let floatBallEnsureTimer = null;
let floatBallUserMoved = false;
let floatBallIsDragging = false;

// 面板切换函数引用（将在初始化时注入）
let togglePanelFn = null;

/**
 * 设置面板切换函数
 * @param {Function} fn 面板切换函数
 */
export function setTogglePanelFunction(fn) {
    togglePanelFn = fn;
}

/**
 * 检测是否是移动端设备
 * @returns {boolean}
 */
function isMobileLikeDevice() {
    return (
        window.innerWidth <= 768 ||
        (typeof window.matchMedia === "function" &&
            window.matchMedia("(pointer: coarse)").matches)
    );
}

/**
 * 获取悬浮球元素
 * @returns {HTMLElement|null}
 */
function getFloatBallElement() {
    return document.getElementById("mm-float-ball") || floatBall;
}

/**
 * 检查悬浮球是否在视口内
 * @param {HTMLElement} ball
 * @returns {boolean}
 */
function isFloatBallInViewport(ball) {
    if (!ball) return false;
    const rect = ball.getBoundingClientRect();
    return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth
    );
}

/**
 * 获取视口度量
 * @param {boolean} useVisualViewportOffset
 * @returns {object}
 */
function getViewportMetrics(useVisualViewportOffset = true) {
    const vv = window.visualViewport;
    if (!vv) {
        return {
            left: 0,
            top: 0,
            width: window.innerWidth,
            height: window.innerHeight,
        };
    }

    return {
        left: useVisualViewportOffset ? vv.offsetLeft : 0,
        top: useVisualViewportOffset ? vv.offsetTop : 0,
        width: vv.width,
        height: vv.height,
    };
}

/**
 * 获取悬浮球期望的底部位置
 * @param {object} options
 * @returns {number}
 */
function getFloatBallDesiredBottomPx({ isMobile, ballSizePx }) {
    const baseBottomPx = isMobile ? 80 : 20;
    let bottomPx = baseBottomPx;

    if (isMobile) {
        const textarea = document.getElementById("send_textarea");
        if (textarea) {
            const rect = textarea.getBoundingClientRect();
            const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
            const distanceToBottom = viewportHeight - rect.top;
            if (Number.isFinite(distanceToBottom) && distanceToBottom > 0) {
                const maxBottomPx = Math.max(baseBottomPx, viewportHeight - ballSizePx - 10);
                bottomPx = Math.min(Math.max(baseBottomPx, distanceToBottom + 16), maxBottomPx);
            }
        }
    }

    return bottomPx;
}

/**
 * 应用悬浮球位置
 * @param {HTMLElement} ball
 * @param {number} leftPx
 * @param {number} topPx
 */
function applyFloatBallPosition(ball, leftPx, topPx) {
    if (!ball) return;
    ball.style.setProperty("left", `${Math.round(leftPx)}px`, "important");
    ball.style.setProperty("top", `${Math.round(topPx)}px`, "important");
    ball.style.setProperty("right", "auto", "important");
    ball.style.setProperty("bottom", "auto", "important");
}

/**
 * 定位悬浮球到锚点
 * @param {object} options
 */
function positionFloatBallToAnchor({ useVisualViewportOffset = true } = {}) {
    const ball = getFloatBallElement();
    if (!ball) return;

    const isMobile = isMobileLikeDevice();
    const fallbackBallSizePx = isMobile ? 36 : 26;
    const rect = ball.getBoundingClientRect();
    const ballWidth = rect.width || fallbackBallSizePx;
    const ballHeight = rect.height || fallbackBallSizePx;

    const bottomPx = getFloatBallDesiredBottomPx({
        isMobile,
        ballSizePx: fallbackBallSizePx,
    });

    const viewport = getViewportMetrics(useVisualViewportOffset);

    const desiredLeft = viewport.left + 15;
    const desiredTop = viewport.top + viewport.height - bottomPx - ballHeight;

    const minLeft = viewport.left;
    const maxLeft = viewport.left + viewport.width - ballWidth;
    const minTop = viewport.top;
    const maxTop = viewport.top + viewport.height - ballHeight;

    const leftPx = Math.max(minLeft, Math.min(desiredLeft, maxLeft));
    const topPx = Math.max(minTop, Math.min(desiredTop, maxTop));

    applyFloatBallPosition(ball, leftPx, topPx);
}

/**
 * 安全定位悬浮球
 */
function positionFloatBallSafely() {
    const ball = getFloatBallElement();
    if (!ball) return;

    positionFloatBallToAnchor({ useVisualViewportOffset: true });
    if (!isFloatBallInViewport(ball)) {
        positionFloatBallToAnchor({ useVisualViewportOffset: false });
    }

    if (!isFloatBallInViewport(ball)) {
        applyFloatBallPosition(ball, 15, 100);
    }
}

/**
 * 确保悬浮球可见
 * @param {object} options
 * @returns {boolean}
 */
function ensureFloatBallVisible({ force = false, retries = 0 } = {}) {
    const ball = getFloatBallElement();
    if (!ball) return false;
    floatBall = ball;

    if (!ball.isConnected) {
        (document.body || document.documentElement)?.appendChild(ball);
    }

    ball.style.setProperty("display", "block", "important");
    ball.style.setProperty("visibility", "visible", "important");
    ball.style.setProperty("opacity", "1", "important");
    ball.style.setProperty("pointer-events", "auto", "important");
    ball.style.setProperty("z-index", "2147483647", "important");

    if (!floatBallIsDragging && (force || !floatBallUserMoved)) {
        positionFloatBallSafely();
    } else if (!floatBallIsDragging && !isFloatBallInViewport(ball)) {
        positionFloatBallSafely();
    }

    const visibleNow = isFloatBallInViewport(ball);
    if (!visibleNow && retries > 0) {
        setTimeout(() => {
            ensureFloatBallVisible({ force: true, retries: retries - 1 });
        }, 250);
    }

    return visibleNow;
}

/**
 * 调度确保悬浮球可见
 * @param {object} options
 */
function scheduleEnsureFloatBallVisible({ force = false, retries = 0 } = {}) {
    if (floatBallEnsureTimer) return;
    floatBallEnsureTimer = setTimeout(() => {
        floatBallEnsureTimer = null;
        ensureFloatBallVisible({ force, retries });
    }, 50);
}

/**
 * 停止悬浮球守护
 */
function stopFloatBallGuard() {
    if (floatBallEnsureTimer) {
        clearTimeout(floatBallEnsureTimer);
        floatBallEnsureTimer = null;
    }
    if (floatBallGuardCleanup) {
        floatBallGuardCleanup();
        floatBallGuardCleanup = null;
    }
}

/**
 * 启动悬浮球守护
 */
function startFloatBallGuard() {
    stopFloatBallGuard();

    const onViewportChange = () => {
        const config = loadConfig();
        const showFloatBall = config?.global?.showFloatBall ?? false;
        if (!showFloatBall) return;
        scheduleEnsureFloatBallVisible({
            force: !floatBallUserMoved,
            retries: 2,
        });
    };

    const vv = window.visualViewport;
    vv?.addEventListener("resize", onViewportChange);
    vv?.addEventListener("scroll", onViewportChange);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
    document.addEventListener("visibilitychange", onViewportChange);

    floatBallGuardCleanup = () => {
        vv?.removeEventListener("resize", onViewportChange);
        vv?.removeEventListener("scroll", onViewportChange);
        window.removeEventListener("resize", onViewportChange);
        window.removeEventListener("orientationchange", onViewportChange);
        document.removeEventListener("visibilitychange", onViewportChange);
    };

    scheduleEnsureFloatBallVisible({ force: true, retries: 4 });
}

/**
 * 初始化悬浮球事件
 */
function initFloatBallEvents() {
    if (!floatBall) return;

    let isDragging = false;
    let hasMoved = false;
    let startX, startY;
    let initialLeft, initialTop;
    const dragThreshold = 5;

    function onDragStart(e) {
        isDragging = true;
        floatBallIsDragging = true;
        hasMoved = false;

        const touch = e.touches ? e.touches[0] : e;
        startX = touch.clientX;
        startY = touch.clientY;

        const rect = floatBall.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        floatBall.classList.add("mm-dragging");

        if (e.type === "touchstart") {
            e.preventDefault();
        }
    }

    function onDragMove(e) {
        if (!isDragging) return;

        const touch = e.touches ? e.touches[0] : e;
        const deltaX = touch.clientX - startX;
        const deltaY = touch.clientY - startY;

        if (Math.abs(deltaX) > dragThreshold || Math.abs(deltaY) > dragThreshold) {
            hasMoved = true;
            floatBallUserMoved = true;
        }

        if (hasMoved) {
            let newLeft = initialLeft + deltaX;
            let newTop = initialTop + deltaY;

            const ballWidth = floatBall.offsetWidth;
            const ballHeight = floatBall.offsetHeight;
            const maxLeft = window.innerWidth - ballWidth;
            const maxTop = window.innerHeight - ballHeight;

            newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            newTop = Math.max(0, Math.min(newTop, maxTop));

            floatBall.style.left = newLeft + "px";
            floatBall.style.top = newTop + "px";
            floatBall.style.bottom = "auto";

            if (e.type === "touchmove") {
                e.preventDefault();
            }
        }
    }

    function onDragEnd() {
        if (!isDragging) return;

        isDragging = false;
        floatBallIsDragging = false;
        floatBall.classList.remove("mm-dragging");

        if (!hasMoved && togglePanelFn) {
            setTimeout(() => {
                togglePanelFn();
            }, 0);
        }
    }

    floatBall.addEventListener("mousedown", onDragStart);
    floatBall.addEventListener("touchstart", onDragStart, { passive: false });
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("touchmove", onDragMove, { passive: false });
    document.addEventListener("mouseup", onDragEnd);
    document.addEventListener("touchend", onDragEnd);

    function onHoverStart() {
        if (floatBallIsDragging) return;
        floatBall.style.transform = "scale(1.15)";
        floatBall.style.filter = "brightness(1.1) saturate(1.2)";

        const inner = floatBall.querySelector(".mm-float-ball-inner");
        const center = floatBall.querySelector(".mm-float-ball-center");
        const ring = floatBall.querySelector(".mm-float-ball-ring");

        if (inner) {
            inner.style.animation = "mm-flower-spin 10s linear infinite";
        }
        if (center) {
            center.style.animation = "mm-center-counter-spin 10s linear infinite";
        }
        if (ring) {
            ring.style.opacity = "1";
            ring.style.transform = "scale(1.1)";
        }
    }

    function onHoverEnd() {
        floatBall.style.transform = "";
        floatBall.style.filter = "";

        const inner = floatBall.querySelector(".mm-float-ball-inner");
        const center = floatBall.querySelector(".mm-float-ball-center");
        const ring = floatBall.querySelector(".mm-float-ball-ring");

        if (inner) inner.style.animation = "";
        if (center) center.style.animation = "";
        if (ring) {
            ring.style.opacity = "0.5";
            ring.style.transform = "";
        }
    }

    floatBall.addEventListener("mouseenter", onHoverStart);
    floatBall.addEventListener("mouseleave", onHoverEnd);

    floatBallCleanup = () => {
        floatBall?.removeEventListener("mousedown", onDragStart);
        floatBall?.removeEventListener("touchstart", onDragStart);
        floatBall?.removeEventListener("mouseenter", onHoverStart);
        floatBall?.removeEventListener("mouseleave", onHoverEnd);
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("touchmove", onDragMove);
        document.removeEventListener("mouseup", onDragEnd);
        document.removeEventListener("touchend", onDragEnd);
        floatBallIsDragging = false;
    };
}

/**
 * 更新悬浮球状态
 */
export function updateFloatBallStatus() {
    if (!floatBall) return;

    const enabled = isPluginEnabled();
    floatBall.classList.remove("mm-enabled", "mm-disabled", "mm-processing");

    if (enabled) {
        floatBall.classList.add("mm-enabled");
    } else {
        floatBall.classList.add("mm-disabled");
    }
}

/**
 * 设置悬浮球处理状态
 * @param {boolean} processing 是否处理中
 */
export function setFloatBallProcessing(processing) {
    if (!floatBall) return;

    floatBall.classList.remove("mm-enabled", "mm-disabled", "mm-processing");

    if (processing) {
        floatBall.classList.add("mm-processing");
    } else {
        updateFloatBallStatus();
    }
}

/**
 * 创建悬浮球
 */
export function createFloatBall() {
    stopFloatBallGuard();

    const existingBall = document.getElementById("mm-float-ball");
    if (existingBall) {
        existingBall.remove();
    }

    if (floatBall) {
        floatBall.remove();
        floatBall = null;
    }

    floatBall = document.createElement("div");
    floatBall.id = "mm-float-ball";
    floatBall.className = "mm-float-ball";
    floatBall.title = "记忆管理";

    const isMobile = isMobileLikeDevice();
    const ballSizePx = isMobile ? 24 : 28;
    const ballSize = `${ballSizePx}px`;

    floatBall.style.cssText = `
        position: fixed !important;
        left: 15px !important;
        top: 100px !important;
        width: ${ballSize} !important;
        height: ${ballSize} !important;
        cursor: pointer !important;
        z-index: 2147483647 !important;
        user-select: none !important;
        touch-action: none !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        transition: transform 0.3s ease, filter 0.3s ease !important;
        pointer-events: auto !important;
    `;

    const innerDiv = document.createElement("div");
    innerDiv.className = "mm-float-ball-inner";
    innerDiv.style.cssText = `
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.3s ease;
    `;

    // 外层花瓣 (8片)
    const outerPetalCount = 8;
    const outerPetalSize = isMobile ? 8 : 10;
    const outerPetalOffset = isMobile ? 9 : 11;

    for (let i = 0; i < outerPetalCount; i++) {
        const petal = document.createElement("div");
        petal.className = "mm-float-ball-petal mm-petal-outer";
        const hue = 280 + ((i * 10) % 30);
        petal.style.cssText = `
            position: absolute;
            width: ${outerPetalSize}px;
            height: ${outerPetalSize * 1.4}px;
            border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
            background: linear-gradient(135deg,
                hsla(${hue}, 35%, 75%, 0.8) 0%,
                hsla(${hue + 15}, 30%, 68%, 0.7) 100%);
            transform: rotate(${i * 45}deg) translateY(-${outerPetalOffset}px);
            box-shadow: 0 0 4px hsla(${hue}, 30%, 70%, 0.3);
            transition: all 0.3s ease;
            z-index: 1;
        `;
        innerDiv.appendChild(petal);
    }

    // 中层花瓣 (6片)
    const midPetalCount = 6;
    const midPetalSize = isMobile ? 6 : 7.5;
    const midPetalOffset = isMobile ? 6 : 7.5;

    for (let i = 0; i < midPetalCount; i++) {
        const petal = document.createElement("div");
        petal.className = "mm-float-ball-petal mm-petal-mid";
        const hue = 320 + ((i * 8) % 25);
        petal.style.cssText = `
            position: absolute;
            width: ${midPetalSize}px;
            height: ${midPetalSize * 1.3}px;
            border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
            background: linear-gradient(135deg,
                hsla(${hue}, 40%, 80%, 0.85) 0%,
                hsla(${hue + 10}, 35%, 72%, 0.75) 100%);
            transform: rotate(${i * 60 + 30}deg) translateY(-${midPetalOffset}px);
            box-shadow: 0 0 3px hsla(${hue}, 35%, 75%, 0.4);
            transition: all 0.3s ease;
            z-index: 2;
        `;
        innerDiv.appendChild(petal);
    }

    // 内层花瓣 (5片)
    const innerPetalCount = 5;
    const innerPetalSize = isMobile ? 4 : 5;
    const innerPetalOffset = isMobile ? 3.5 : 4.5;

    for (let i = 0; i < innerPetalCount; i++) {
        const petal = document.createElement("div");
        petal.className = "mm-float-ball-petal mm-petal-inner";
        petal.style.cssText = `
            position: absolute;
            width: ${innerPetalSize}px;
            height: ${innerPetalSize * 1.2}px;
            border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
            background: linear-gradient(135deg,
                rgba(255, 235, 245, 0.9) 0%,
                rgba(245, 220, 235, 0.8) 100%);
            transform: rotate(${i * 72 + 15}deg) translateY(-${innerPetalOffset}px);
            box-shadow: 0 0 2px rgba(240, 200, 220, 0.5);
            transition: all 0.3s ease;
            z-index: 3;
        `;
        innerDiv.appendChild(petal);
    }

    // 花心
    const centerSize = isMobile ? 7 : 9;
    const center = document.createElement("div");
    center.className = "mm-float-ball-center";
    center.style.cssText = `
        position: absolute;
        width: ${centerSize}px;
        height: ${centerSize}px;
        border-radius: 50%;
        background: radial-gradient(circle at 40% 40%,
            rgba(255, 245, 210, 1) 0%,
            rgba(255, 225, 170, 0.9) 40%,
            rgba(245, 200, 140, 0.85) 100%);
        box-shadow: 0 0 5px rgba(255, 220, 160, 0.5),
            inset 0 1px 2px rgba(255, 250, 230, 0.7);
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // 花蕊小点
    const stamenCount = 5;
    const stamenSize = isMobile ? 1.5 : 2;
    const stamenOffset = isMobile ? 2 : 2.5;

    for (let i = 0; i < stamenCount; i++) {
        const stamen = document.createElement("div");
        stamen.className = "mm-float-ball-stamen";
        stamen.style.cssText = `
            position: absolute;
            width: ${stamenSize}px;
            height: ${stamenSize}px;
            border-radius: 50%;
            background: radial-gradient(circle,
                rgba(255, 248, 220, 1) 0%,
                rgba(255, 230, 160, 1) 100%);
            transform: rotate(${i * 72}deg) translateY(-${stamenOffset}px);
            box-shadow: 0 0 2px rgba(255, 235, 180, 0.6);
            z-index: 11;
        `;
        center.appendChild(stamen);
    }

    innerDiv.appendChild(center);

    // 外圈光晕
    const ring = document.createElement("div");
    ring.className = "mm-float-ball-ring";
    ring.style.cssText = `
        position: absolute;
        inset: -4px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255, 210, 230, 0.35) 0%, rgba(230, 200, 220, 0.18) 50%, transparent 70%);
        opacity: 0.5;
        transition: opacity 0.3s ease, transform 0.3s ease;
        pointer-events: none;
    `;

    floatBall.appendChild(innerDiv);
    floatBall.appendChild(ring);

    let parentEl = document.body || document.documentElement;
    try {
        const body = document.body;
        if (body && document.documentElement && getComputedStyle(body).transform !== "none") {
            parentEl = document.documentElement;
        }
    } catch (e) {
        // 忽略
    }
    parentEl?.appendChild(floatBall);

    initFloatBallEvents();
    updateFloatBallStatus();
    floatBallUserMoved = false;
    floatBallIsDragging = false;
    startFloatBallGuard();
    ensureFloatBallVisible({ force: true, retries: 8 });
}

/**
 * 移除悬浮球
 */
export function removeFloatBall() {
    stopFloatBallGuard();
    if (floatBallCleanup) {
        floatBallCleanup();
        floatBallCleanup = null;
    }
    const existingBall = document.getElementById("mm-float-ball");
    if (existingBall) {
        existingBall.remove();
    }
    if (floatBall) {
        floatBall.remove();
        floatBall = null;
    }
    floatBallUserMoved = false;
    floatBallIsDragging = false;
}

/**
 * 根据设置显示/隐藏悬浮球
 */
export function updateFloatBallVisibility() {
    const config = loadConfig();
    const showFloatBall = config?.global?.showFloatBall ?? false;

    if (showFloatBall) {
        const existingBall = document.getElementById("mm-float-ball");
        const ballEl = existingBall || floatBall;
        let isHidden = false;
        if (ballEl) {
            try {
                const cs = getComputedStyle(ballEl);
                isHidden =
                    cs.display === "none" ||
                    cs.visibility === "hidden" ||
                    parseFloat(cs.opacity) === 0 ||
                    ballEl.getBoundingClientRect().width === 0 ||
                    ballEl.getBoundingClientRect().height === 0;
            } catch (e) {
                isHidden = false;
            }
        }

        if (!existingBall || !floatBall || !ballEl?.isConnected || isHidden) {
            createFloatBall();
        } else {
            floatBall = existingBall;
            startFloatBallGuard();
            ensureFloatBallVisible({ force: true, retries: 4 });
        }
    } else {
        removeFloatBall();
    }
}
