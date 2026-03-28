<template>
  <div class="app-container">

    <!-- ── MOBILE TOP BAR ─────────────────────────────────────────────── -->
    <div v-if="currentUser" class="mobile-topbar">
      <button class="mobile-hamburger" @click="showMobileMenu = !showMobileMenu" :class="{ open: showMobileMenu }">
        <span></span><span></span><span></span>
      </button>
      <div class="mobile-topbar-center">
        <span class="mobile-date">📅 {{ formattedDate }}</span>
        <span class="mobile-gold">💰 {{ Number(playerGold).toLocaleString('es-ES') }}</span>
      </div>
      <div class="mobile-topbar-right">
        {{ currentUser.culture_id === 1 ? 'Gens' : 'Casa' }} {{ currentUser.display_name || currentUser.username }}
      </div>
    </div>

    <!-- ── MOBILE DRAWER OVERLAY ──────────────────────────────────────── -->
    <div v-if="showMobileMenu" class="mobile-drawer-overlay" @click="showMobileMenu = false"></div>

    <!-- ── MOBILE DRAWER ──────────────────────────────────────────────── -->
    <div class="mobile-drawer" :class="{ open: showMobileMenu }">
      <div class="mobile-drawer-header">
        <span>⚔️ Hispania 210 a.C.</span>
        <button class="mobile-drawer-close" @click="showMobileMenu = false">✕</button>
      </div>
      <nav class="mobile-drawer-nav">
        <button class="mobile-drawer-btn" @click="openOverlay('reino');  showMobileMenu = false"><span>🏰</span> Imperium</button>
        <button class="mobile-drawer-btn" @click="openOverlay('characters'); showMobileMenu = false"><span>👑</span> Dinastía</button>
        <button class="mobile-drawer-btn" @click="openOverlay('diplomacy'); showMobileMenu = false">
          <span>⚖️</span> Diplomacia
          <span v-if="pendingRelationsCount > 0" class="mobile-badge">{{ pendingRelationsCount }}</span>
        </button>
        <button class="mobile-drawer-btn" @click="openOverlay('economy'); showMobileMenu = false"><span>💰</span> Economía</button>
        <button class="mobile-drawer-btn" @click="togglePanel('market');  showMobileMenu = false"><span>🏪</span> Mercado</button>
        <button class="mobile-drawer-btn" @click="openOverlay('troops');  showMobileMenu = false"><span>⚔️</span> Tropas</button>
        <button class="mobile-drawer-btn" @click="openOverlay('naval');   showMobileMenu = false"><span>⛵</span> Flotas</button>
        <button class="mobile-drawer-btn" @click="openOverlay('messages'); showMobileMenu = false">
          <span>📜</span> Mensajes
          <span v-if="unreadCount > 0" class="mobile-badge">{{ unreadCount }}</span>
        </button>
        <button class="mobile-drawer-btn" @click="togglePanel('notifications'); showMobileMenu = false">
          <span>🔔</span> Notificaciones
          <span v-if="unreadNotifCount > 0" class="mobile-badge">{{ unreadNotifCount }}</span>
        </button>
        <button class="mobile-drawer-btn" @click="openOverlay('layers'); showMobileMenu = false"><span>🗺️</span> Mapa</button>
      </nav>
      <div class="mobile-drawer-footer">
        <button v-if="currentUser && currentUser.role === 'admin'" class="mobile-drawer-btn" @click="openOverlay('admin'); showMobileMenu = false"><span>⚙️</span> Administración</button>
        <button class="mobile-drawer-btn" @click="showChangelog = !showChangelog; showMobileMenu = false"><span>📋</span> Novedades</button>
        <button class="mobile-drawer-btn mobile-drawer-logout" @click="handleLogout"><span>🚪</span> Cerrar Sesión</button>
      </div>
    </div>

    <!-- Full Background Map -->
    <div class="map-background">
      <div v-if="loading" class="loading-overlay">
        <div class="spinner"></div>
        <p>Cargando mapa...</p>
      </div>
      <div v-if="error" class="error-message">
        <p>❌ Error: {{ error }}</p>
      </div>
      <div id="map" ref="mapContainer"></div>

      <!-- H3 Search Widget (flotante sobre el mapa, esquina superior izquierda) -->
      <div class="h3-search-widget">
        <input
          type="text"
          v-model="searchH3Input"
          placeholder="lat lon ó h3"
          @keyup.enter="goToH3Index"
          class="h3-search-input"
        />
        <button @click="goToH3Index" class="h3-search-btn">🔍</button>
      </div>
    </div>

    <!-- Main Sidebar -->
    <aside id="main-sidebar" class="main-sidebar">
      <!-- Sidebar Header -->
      <div class="sidebar-header">
        <div class="header-stat">
          <span class="stat-icon gold-icon">💰</span>
          <div class="stat-info">
            <span class="stat-value">{{ Number(playerGold).toLocaleString('es-ES') }}</span>
            <span class="stat-label">Oro</span>
          </div>
        </div>
        <div class="header-date">
          <div class="date-row">
            <span class="date-icon">📅</span>
            <span class="date-value">{{ formattedDate }}</span>
          </div>
          <div class="date-row">
            <span class="date-icon">⚔️</span>
            <span class="date-label">Turno {{ currentTurn }}</span>
          </div>
          <div class="date-row harvest-row">
            <span class="date-icon">🌾</span>
            <span class="harvest-text">{{ nextHarvestLabel }}</span>
          </div>
        </div>
      </div>

      <!-- Sidebar Navigation -->
      <nav class="sidebar-nav">
        <button
          class="nav-button"
          :class="{ active: activeOverlay === 'reino' }"
          @click="openOverlay('reino')"
          title="Imperium"
        >
          <span class="nav-icon">🏰</span>
          <span class="nav-label">Imperium</span>
        </button>
        <button
          class="nav-button"
          :class="{ active: activeOverlay === 'characters' }"
          @click="openOverlay('characters')"
          title="Personajes y Dinastía"
        >
          <span class="nav-icon">👑</span>
          <span class="nav-label">Dinastía</span>
        </button>
        <button
          class="nav-button"
          :class="{ active: activeOverlay === 'diplomacy' }"
          @click="openOverlay('diplomacy')"
          title="Diplomacia"
        >
          <span class="nav-icon">⚖️</span>
          <span class="nav-label">Diplomacia</span>
          <span v-if="pendingRelationsCount > 0" class="nav-badge">{{ pendingRelationsCount }}</span>
        </button>
        <button
          class="nav-button"
          :class="{ active: activeOverlay === 'economy' }"
          @click="openOverlay('economy')"
          title="Economía"
        >
          <span class="nav-icon">💰</span>
          <span class="nav-label">Economía</span>
        </button>
        <button
          class="nav-button"
          :class="{ active: activePanel === 'market' }"
          @click="togglePanel('market')"
          title="Mercado"
        >
          <span class="nav-icon">🏪</span>
          <span class="nav-label">Mercado</span>
        </button>
        <button
          class="nav-button"
          :class="{ active: activeOverlay === 'troops' }"
          @click="openOverlay('troops')"
          title="Tropas"
        >
          <span class="nav-icon">⚔️</span>
          <span class="nav-label">Tropas</span>
        </button>
        <button
          class="nav-button"
          :class="{ active: activeOverlay === 'naval' }"
          @click="openOverlay('naval')"
          title="Flotas Navales"
        >
          <span class="nav-icon">⛵</span>
          <span class="nav-label">Flotas</span>
        </button>
        <button
          class="nav-button"
          :class="{ active: activeOverlay === 'messages' }"
          @click="openOverlay('messages')"
          title="Mensajes"
        >
          <span class="nav-icon">📜</span>
          <span class="nav-label">Mensajes</span>
          <span v-if="unreadCount > 0" class="nav-badge">{{ unreadCount }}</span>
        </button>
        <button
          class="nav-button"
          :class="{ active: activePanel === 'notifications' }"
          @click="togglePanel('notifications')"
          title="Notificaciones"
        >
          <span class="nav-icon">🔔</span>
          <span class="nav-label">Notificaciones</span>
          <span v-if="unreadNotifCount > 0" class="nav-badge">{{ unreadNotifCount }}</span>
        </button>
        <button
          class="nav-button"
          :class="{ active: activeOverlay === 'layers' }"
          @click="openOverlay('layers')"
          title="Mapa"
        >
          <span class="nav-icon">🗺️</span>
          <span class="nav-label">Mapa</span>
        </button>
      </nav>

      <!-- Sidebar Footer -->
      <div class="sidebar-footer">
        <button
          v-if="currentUser"
          class="user-info-footer"
          :class="{ active: activePanel === 'profile' }"
          @click="togglePanel('profile')"
          title="Editar perfil"
        >
          <span class="username">{{ currentUser.culture_id === 1 ? 'Gens' : 'Casa' }} {{ currentUser.display_name || currentUser.username }}</span>
          <span v-if="currentUser.culture_name" class="culture-badge">{{ currentUser.culture_name }}</span>
        </button>
        <div v-if="currentUser" class="footer-actions">
          <button
            v-if="currentUser.role === 'admin'"
            class="footer-button admin-button"
            :class="{ active: activeOverlay === 'admin' }"
            title="Panel de Administración"
            @click="openOverlay('admin')"
          >
            <span class="footer-icon">⚙️</span>
          </button>
          <button
            class="footer-button changelog-button"
            :class="{ active: showChangelog }"
            title="Novedades"
            @click="showChangelog = !showChangelog"
          >
            <span class="footer-icon">📋</span>
          </button>
          <button
            class="footer-button logout-button"
            @click="handleLogout"
            title="Cerrar Sesión"
          >
            <span class="footer-icon">🚪</span>
          </button>
        </div>
      </div>
      <div class="legal-links">
        <a href="/legal/privacidad.html" target="_blank" rel="noopener">Privacidad</a>
        <span class="legal-sep">·</span>
        <a href="/legal/terminos.html" target="_blank" rel="noopener">Términos</a>
        <span class="legal-sep">·</span>
        <a href="/legal/aviso-legal.html" target="_blank" rel="noopener">Aviso Legal</a>
      </div>
    </aside>

    <!-- Context Panel -->
    <aside
      id="context-panel"
      class="context-panel"
      :class="{ open: activePanel !== null || activeOverlay === 'layers' }"
      :style="{ transform: (activePanel !== null || activeOverlay === 'layers') ? 'translateX(0)' : 'translateX(-100%)' }"
    >
      <div class="panel-header">
        <h3 class="panel-title">
          {{ activeOverlay === 'layers' ? '🗺️ Capas del Mapa' : panelTitle }}
        </h3>
        <button class="panel-close" @click="activeOverlay ? activeOverlay = null : closePanel()">✕</button>
      </div>

      <div class="panel-content">
        <!-- Layers Panel -->
        <div v-if="activeOverlay === 'layers'" class="panel-section layers-panel">
          <!-- Legend -->
          <div class="legend-section">
            <h4 class="section-title">📜 Leyenda de Terrenos</h4>
            <div v-if="terrainTypes.length === 0" class="section-loading">
              Cargando tipos de terreno...
            </div>
            <div v-else class="legend-items">
              <div
                v-for="terrain in terrainTypes"
                :key="terrain.terrain_type_id"
                class="legend-item"
              >
                <div
                  class="legend-color-circle"
                  :style="{ backgroundColor: terrain.color }"
                ></div>
                <div class="legend-info">
                  <span class="legend-name">{{ terrain.name }}</span>
                  <span class="legend-capacity">Máx: {{ getTerrainCapacity(terrain.name) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Visibility Controls -->
          <div class="visibility-section">
            <h4 class="section-title">👁️ Capas de Visualización</h4>
            <div class="toggle-container">
              <label class="toggle-label">
                <input
                  type="checkbox"
                  v-model="showTerrainLayer"
                  @change="toggleTerrainLayer"
                  class="toggle-checkbox"
                />
                <span class="toggle-slider"></span>
                <span class="toggle-text">🗺️ Capa Terreno</span>
              </label>
            </div>
            <div class="toggle-container">
              <label class="toggle-label">
                <input
                  type="checkbox"
                  v-model="isPoliticalView"
                  @change="togglePoliticalView"
                  class="toggle-checkbox"
                />
                <span class="toggle-slider"></span>
                <span class="toggle-text">🏛️ Vista Política</span>
              </label>
            </div>
            <div class="toggle-container">
              <label class="toggle-label">
                <input
                  type="checkbox"
                  v-model="showH3Layer"
                  @change="toggleH3Layer"
                  class="toggle-checkbox"
                />
                <span class="toggle-slider"></span>
                <span class="toggle-text">⬡ Cuadrícula H3</span>
              </label>
            </div>
          </div>

          <!-- Transparency Slider -->
          <div class="transparency-section">
            <h4 class="section-title">💎 Transparencia de Capas</h4>
            <div class="slider-container">
              <label class="slider-label">Opacidad:</label>
              <input
                type="range"
                min="0"
                max="100"
                v-model="hexagonOpacity"
                @input="updateHexagonOpacity"
                class="opacity-slider"
              />
              <span class="opacity-value">{{ hexagonOpacity }}%</span>
            </div>
          </div>

          <!-- Dynamic Telemetry -->
          <div class="telemetry-section">
            <h4 class="section-title">📊 Telemetría en Tiempo Real</h4>
            <div class="telemetry-grid">
              <div class="telemetry-item">
                <span class="telemetry-label">Zoom Actual:</span>
                <span class="telemetry-value">{{ currentZoom }}</span>
              </div>
              <div class="telemetry-item">
                <span class="telemetry-label">Resolución H3:</span>
                <span class="telemetry-value">{{ currentResolution }}</span>
              </div>
              <div class="telemetry-item">
                <span class="telemetry-label">Hexágonos Totales:</span>
                <span class="telemetry-value">{{ hexagonCount }}</span>
              </div>
            </div>
          </div>

        </div>

        <!-- Kingdom Management Panel - MOVED TO FULLSCREEN OVERLAY -->

        <!-- Troops Panel - MOVED TO FULLSCREEN OVERLAY -->

        <!-- Market Panel -->
        <div v-if="activePanel === 'market'" class="panel-section market-panel">

          <!-- ── Contratar Trabajador ───────────────────────────────────── -->
          <div class="market-section">
            <div class="market-section-title">⛏️ Contratar Trabajador</div>
            <div class="market-hire-form">
              <div class="market-worker-type-buttons">
                <button
                  v-for="t in workerTypes"
                  :key="t.id"
                  class="market-worker-type-btn"
                  :class="{ active: marketHireTypeId === t.id }"
                  @click="marketHireTypeId = t.id"
                >
                  <span class="worker-type-icon">{{ workerTypeIcon(t.name) }}</span>
                  <span class="worker-type-name">{{ t.name }}</span>
                  <span class="worker-type-cost">{{ Number(t.cost).toLocaleString('es-ES') }} 💰</span>
                </button>
              </div>
              <select v-model="marketHireH3" class="market-select">
                <option disabled value="null">Feudo de contratación…</option>
                <option v-for="loc in workerHireLocations" :key="loc.h3_index" :value="loc.h3_index">
                  {{ loc.is_capital ? '👑 Capital' : '🏪 ' + (loc.settlement_name || loc.h3_index) }}
                </option>
              </select>
              <button
                class="market-btn market-btn-hire"
                :disabled="!marketHireTypeId || !marketHireH3"
                @click="buyWorkerFromMarketPanel(marketHireH3, marketHireTypeId)"
                title="Contratar trabajador en el feudo seleccionado"
              >⛏️ Contratar</button>
            </div>
            <p v-if="workerHireLocations.length === 0" class="market-hint">
              Necesitas una Capital o un edificio económico completado para contratar.
            </p>
          </div>

          <!-- ── Mercado de Alimentos ───────────────────────────────────── -->
          <div class="market-section">
            <div class="market-section-title">🌾 Mercado de Alimentos</div>
            <div class="market-food-price-row">
              <span class="market-price-label">Precio unitario</span>
              <span class="market-price-value">— 💰 / u</span>
            </div>
            <div class="market-food-form">
              <input
                v-model.number="marketFoodAmount"
                type="number" min="1" step="50"
                class="market-qty-input"
                placeholder="Cantidad"
              />
              <span class="market-food-total">≈ — 💰</span>
            </div>
            <div class="market-food-actions">
              <button class="market-btn market-btn-buy" disabled title="Próximamente">
                🛒 Comprar
              </button>
              <button class="market-btn market-btn-sell" disabled title="Próximamente">
                💰 Vender
              </button>
            </div>
          </div>

          <!-- ── Mis Trabajadores ──────────────────────────────────────── -->
          <div class="market-section">
            <div class="market-section-header">
              <div class="market-section-title">
                👷 Mis Trabajadores
                <span class="market-worker-count">{{ myWorkers.length }}</span>
              </div>
              <button class="btn-refresh-workers" @click="fetchMyWorkers" :disabled="loadingWorkers" title="Actualizar">
                {{ loadingWorkers ? '⏳' : '🔄' }}
              </button>
            </div>

            <div v-if="loadingWorkers" class="workers-loading">Cargando trabajadores...</div>

            <div v-else-if="myWorkers.length === 0" class="workers-empty">
              <p>No tienes trabajadores contratados.</p>
            </div>

            <div v-else class="workers-list">
              <div
                v-for="worker in myWorkers"
                :key="worker.id"
                class="worker-card"
              >
                <div class="worker-card-top">
                  <span class="worker-type-badge">⛏️ {{ worker.type_name }}</span>
                  <span class="worker-id">#{{ worker.id }}</span>
                </div>
                <div class="worker-card-info">
                  <span title="Ubicación actual">📍 {{ cellToLatLng(worker.h3_index).map(v => v.toFixed(3)).join(', ') }} ({{ worker.h3_index }})</span>
                  <span v-if="worker.terrain_type" class="worker-terrain">🌍 {{ worker.terrain_type }}</span>
                  <span v-if="worker.destination_h3" class="worker-en-route" title="Destino">
                    ➡️ {{ cellToLatLng(worker.destination_h3).map(v => v.toFixed(3)).join(', ') }} ({{ worker.destination_h3 }})
                  </span>
                </div>
                <div class="worker-card-stats">
                  <span title="Velocidad">💨 {{ worker.speed }}</span>
                  <span title="Coste">💰 {{ worker.cost }}</span>
                </div>
                <div class="worker-card-actions">
                  <button
                    v-if="['Río','Agua'].includes(worker.terrain_type)"
                    class="worker-btn worker-btn-build-active"
                    title="Construir puente (consume trabajadores)"
                    @click="buildBridgeFromPanel(worker.h3_index)"
                  >🌉 Puente</button>
                  <button
                    v-else
                    class="worker-btn worker-btn-build-active"
                    title="Construir edificio en este feudo"
                    @click="buildModalOpenedFromWorker = true; activePanel = null; openBuildModal(worker.h3_index)"
                  >🏛️ Construir</button>
                  <button
                    class="worker-btn worker-btn-move"
                    @click="startWorkerMoveFromPanel(worker.id, worker.h3_index)"
                    title="Mover este trabajador"
                  >➡️ Mover</button>
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- Kingdom Panel (Fiefs) -->
        <div v-if="activePanel === 'kingdom'" class="panel-section kingdom-panel">
          <div class="fiefs-list" @scroll="handleFiefsScroll">
            <div v-if="loadingFiefs" class="fiefs-empty">
              Cargando feudos...
            </div>
            <div v-else-if="myFiefs.length === 0" class="fiefs-empty">
              No tienes feudos aún. ¡Coloniza territorios para comenzar!
            </div>
            <div
              v-for="fief in displayedFiefs"
              :key="fief.h3_index"
              class="fief-card"
              :class="{ 'fief-low-food': Number(fief.food_stored || 0) < 5.0 }"
              @click="focusOnFief(fief.h3_index)"
            >
              <div class="fief-name">
                {{ fief.location_name || fief.h3_index?.substring(0, 8) || 'Territorio' }}
              </div>
              <div class="fief-terrain">{{ fief.terrain_name || 'Desconocido' }}</div>
              <div class="fief-stats">
                <span class="fief-stat">
                  <span class="fief-icon">👥</span>
                  <span class="fief-value">{{ Math.floor(Number(fief.population || 0)) }}</span>
                </span>
                <span class="fief-stat">
                  <span class="fief-icon">🌾</span>
                  <span class="fief-value fief-food">{{ Number(fief.food_stored || 0).toFixed(1) }}</span>
                </span>
                <span class="fief-stat">
                  <span class="fief-icon">⏳</span>
                  <span class="fief-value fief-autonomy"
                    :class="{
                      'fief-autonomy--ok':  (() => { const c = Math.floor(Number(fief.population||0)/100)*0.1; return c>0 && Math.floor(Number(fief.food_stored||0)/c) >= 200; })(),
                      'fief-autonomy--low': (() => { const c = Math.floor(Number(fief.population||0)/100)*0.1; return c>0 && Math.floor(Number(fief.food_stored||0)/c) < 30; })()
                    }"
                  >{{ (() => { const c = Math.floor(Number(fief.population||0)/100)*0.1; return c > 0 ? Math.floor(Number(fief.food_stored||0)/c) + 'd' : '∞'; })() }}</span>
                </span>
              </div>
            </div>
            <div v-if="loadingMoreFiefs" class="loading-more">
              Cargando más feudos...
            </div>
          </div>
        </div>

        <!-- Messages Panel -->
        <div v-if="activePanel === 'messages'" class="panel-section messages-panel-container">
          <div class="messages-split">
            <!-- Message List -->
            <div class="messages-list-column">
              <div v-if="loadingMessages" class="messages-empty">
                Cargando mensajes...
              </div>
              <div v-else-if="myMessages.length === 0" class="messages-empty">
                No tienes mensajes.
              </div>
              <div
                v-for="message in myMessages"
                :key="message.id"
                class="message-card"
                :class="{
                  'message-unread': !message.is_read,
                  'message-selected': selectedMessage && selectedMessage.id === message.id
                }"
                @click="readMessage(message)"
              >
                <div class="message-header">
                  <span class="message-sender">
                    {{ message.sender_name || '🏰 Sistema' }}
                  </span>
                  <span class="message-date">{{ formatMessageDate(message.sent_at) }}</span>
                </div>
                <div class="message-subject">{{ message.subject }}</div>
                <div class="message-preview">{{ message.body.substring(0, 60) }}...</div>
              </div>
            </div>

            <!-- Message Viewer -->
            <div class="messages-viewer-column">
              <div v-if="!selectedMessage" class="no-message-selected">
                Selecciona un mensaje para ver su contenido
              </div>
              <div v-else class="message-detail">
                <div class="message-detail-meta">
                  <span class="message-detail-sender">
                    De: {{ selectedMessage.sender_name || '🏰 Sistema' }}
                  </span>
                  <span class="message-detail-date">
                    {{ formatMessageDate(selectedMessage.sent_at) }}
                  </span>
                </div>
                <h4 class="message-detail-subject">{{ selectedMessage.subject }}</h4>
                <div class="message-detail-content">
                  {{ selectedMessage.body }}
                </div>
                <button
                  v-if="selectedMessage.h3_index"
                  class="message-map-button"
                  @click="focusOnHexFromMessage(selectedMessage.h3_index)"
                >
                  🗺️ Ver en Mapa
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Notifications Panel -->
        <div v-if="activePanel === 'notifications'" class="panel-section notifications-panel">
          <NotificationsPanel
            :notifications="notifications"
            :loading="loadingNotifications"
            :currentTurn="currentTurn"
            :gameDate="gameDate"
            @read="handleNotificationRead"
            @readTab="handleNotificationsReadTab"
          />
        </div>

        <!-- Profile Panel -->
        <div v-if="activePanel === 'profile'" class="panel-section profile-panel">
          <div class="profile-info">
            <p class="profile-field-label">Usuario de acceso</p>
            <p class="profile-username">{{ currentUser?.username }}</p>
          </div>
          <div class="profile-edit-section">
            <p class="profile-field-label">Nombre de personaje</p>
            <input
              :value="profileDisplayName"
              class="profile-input profile-input--readonly"
              type="text"
              readonly
            />
          </div>
        </div>
      </div>
    </aside>

    <!-- Action Panel (floating, for hex clicks) -->
      <div
        v-if="showActionPanel && selectedHexData"
        class="action-panel"
        :style="{ left: actionPanelPosition.x + 'px', top: actionPanelPosition.y + 'px' }"
      >
        <div class="action-panel-header">
          <h3>⚔️ Territorio</h3>
          <button class="close-button" @click="closeActionPanel">✕</button>
        </div>
        <div class="action-panel-body">
          <!-- Hex Info -->
          <div class="hex-info">
            <p><strong>Terreno:</strong> {{ selectedHexData.terrain_name || 'Desconocido' }}</p>
            <p v-if="selectedHexData.location_name">
              <strong>Nombre:</strong> {{ selectedHexData.location_name }}
            </p>
            <p v-if="selectedHexData.owner_name">
              <strong>Dueño:</strong>
              <span :style="{ color: selectedHexData.player_color }">
                {{ selectedHexData.owner_name }}
              </span>
            </p>
          </div>

          <!-- Actions -->
          <div class="actions">
            <!-- Colonize button if unclaimed -->
            <button
              v-if="!selectedHexData.player_id"
              class="action-button colonize-button"
              @click="colonizeTerritory"
              :disabled="playerGold < 100 || isColonizing"
            >
              🏰 Colonizar (100 💰)
            </button>

            <!-- If already owned -->
            <div v-else class="owned-message">
              <p v-if="selectedHexData.player_id === playerId">✅ Este territorio es tuyo</p>
              <p v-else>🛡️ Territorio enemigo</p>
            </div>
          </div>
        </div>
      </div>

    <!-- Admin Panel Overlay (admin only) -->
    <AdminPanel
      v-if="activeOverlay === 'admin'"
      @close="closeOverlay"
      @go-to-hex="handleAdminGoToHex"
    />

    <!-- Full-Screen Messages Overlay -->
    <div v-if="activeOverlay === 'messages'" class="game-overlay">
      <div class="overlay-container">
        <!-- Header with close button -->
        <div class="overlay-header">
          <h1 class="overlay-title">📜 Mensajes</h1>
          <button class="overlay-close" @click="closeOverlay" title="Cerrar">✕</button>
        </div>

        <!-- 3-Column Layout -->
        <div class="overlay-content">
          <!-- Column 1: Messages List -->
          <div class="messages-list-column">
            <div class="message-tabs">
              <button
                :class="['tab-button', { active: messageFilter === 'received' }]"
                @click="messageFilter = 'received'"
              >
                📥 Recibidos
              </button>
              <button
                :class="['tab-button', { active: messageFilter === 'sent' }]"
                @click="messageFilter = 'sent'"
              >
                📤 Enviados
              </button>
            </div>
            <div class="messages-list">
              <div
                v-for="message in filteredMessages"
                :key="message.id"
                :class="['message-item', { 'message-unread': !message.is_read, 'message-selected': selectedMessage?.id === message.id }]"
                @click="selectMessage(message)"
              >
                <div class="message-item-header">
                  <span class="message-sender">{{ message.sender_username || 'Sistema' }}</span>
                  <span class="message-date">{{ new Date(message.sent_at).toLocaleDateString() }}</span>
                </div>
                <div class="message-subject">{{ message.subject }}</div>
              </div>
              <div v-if="myMessages.length === 0" class="empty-state">
                <p>📭 No tienes mensajes</p>
              </div>
            </div>
          </div>

          <!-- Column 2: Message Viewer -->
          <div class="message-viewer-column">
            <h2 class="column-title">Lectura</h2>
            <div v-if="selectedMessage" class="message-viewer">
              <div class="message-header">
                <h3 class="message-title">{{ selectedMessage.subject }}</h3>
                <div class="message-meta">
                  <span class="message-from">De: {{ selectedMessage.sender_username || 'Sistema' }}</span>
                  <span class="message-time">{{ new Date(selectedMessage.sent_at).toLocaleString() }}</span>
                </div>
              </div>
              <div class="message-body">
                <p>{{ selectedMessage.body }}</p>
              </div>
              <div class="message-actions">
                <button class="btn-primary" @click="replyToMessage(selectedMessage)">
                  ↩️ Responder
                </button>
                <button
                  v-if="selectedMessage.h3_index"
                  class="btn-secondary"
                  @click="goToMessageLocation(selectedMessage.h3_index)"
                >
                  🗺️ Ir al Mapa
                </button>
              </div>

              <!-- Thread View -->
              <div v-if="threadMessages.length > 1" class="message-thread">
                <h4 class="thread-title">🧵 Conversación ({{ threadMessages.length }} mensajes)</h4>
                <div class="thread-messages">
                  <div
                    v-for="msg in threadMessages"
                    :key="msg.id"
                    :class="['thread-message', { 'thread-message-current': msg.id === selectedMessage.id }]"
                  >
                    <div class="thread-message-header">
                      <strong>{{ msg.sender_username }}</strong>
                      <span class="thread-message-date">{{ formatMessageDate(msg.sent_at) }}</span>
                    </div>
                    <div class="thread-message-subject">{{ msg.subject }}</div>
                    <div class="thread-message-body">{{ msg.body }}</div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="empty-state">
              <p>👈 Selecciona un mensaje para leerlo</p>
            </div>
          </div>

          <!-- Column 3: Compose Message -->
          <div class="message-compose-column">
            <h2 class="column-title">Redactar</h2>
            <form class="message-compose-form" @submit.prevent="sendMessage">
              <div class="form-group">
                <label for="msg-recipient">Para (Usuario):</label>
                <input
                  id="msg-recipient"
                  v-model="messageRecipient"
                  type="text"
                  placeholder="Nombre de usuario"
                  required
                />
              </div>
              <div class="form-group">
                <label for="msg-subject">Asunto:</label>
                <input
                  id="msg-subject"
                  v-model="messageSubject"
                  type="text"
                  placeholder="Asunto del mensaje"
                  required
                />
              </div>
              <div class="form-group">
                <label for="msg-body">Mensaje:</label>
                <textarea
                  id="msg-body"
                  v-model="messageBody"
                  placeholder="Escribe tu mensaje..."
                  rows="12"
                  required
                ></textarea>
              </div>
              <button type="submit" class="btn-send" :disabled="sendingMessage">
                {{ sendingMessage ? '📤 Enviando...' : '📨 Enviar Mensaje' }}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>

    <!-- Full-Screen Kingdom Overlay -->
    <div v-if="activeOverlay === 'reino'" class="game-overlay title-overlay">
      <div class="overlay-container">
        <!-- Header -->
        <div class="overlay-header">
          <h1 class="overlay-title">🏰 Gestión del Imperium</h1>
          <button class="overlay-close" @click="closeOverlay" title="Cerrar">✕</button>
        </div>

        <!-- Kingdom Content -->
        <div class="overlay-content kingdom-content">
          <!-- Left Sidebar for Controls -->
          <div class="kingdom-sidebar">
            <div class="sidebar-section">
              <h4 class="sidebar-subtitle">🛠️ Acciones</h4>
              <div class="kingdom-actions-vertical">
                <button
                  class="kingdom-action-btn-sidebar"
                  :class="{ active: activeKingdomTab === 'fiefs' }"
                  @click="activeKingdomTab = 'fiefs'"
                  title="Ver listado de feudos"
                >
                  🏰 Feudos
                </button>
                <button
                  class="kingdom-action-btn-sidebar"
                  :class="{ active: activeKingdomTab === 'divisions' }"
                  @click="activeKingdomTab = 'divisions'"
                  title="Gestionar divisiones politicas y rangos nobiliarios"
                >
                  📜 Edictos
                </button>
              </div>
            </div>

            <div class="sidebar-section">
              <h4 class="sidebar-subtitle">🔍 Filtros</h4>
              <div class="kingdom-filters-vertical">
                <div class="filter-group">
                  <label>Nombre del feudo</label>
                  <input
                    v-model="kingdomFilters.name"
                    type="text"
                    placeholder="Buscar..."
                    class="kingdom-filter-input-sidebar"
                  />
                </div>
                <div class="filter-group">
                  <label>Señorío</label>
                  <select
                    v-model="kingdomFilters.division"
                    class="kingdom-filter-input-sidebar"
                  >
                    <option value="">Todos</option>
                    <option value="__none__">Sin señorío</option>
                    <option
                      v-for="div in myDivisions"
                      :key="div.id"
                      :value="div.name"
                    >{{ div.name }}</option>
                  </select>
                </div>
                <div class="filter-group">
                  <label>Población Máxima</label>
                  <input
                    v-model.number="kingdomFilters.maxPopulation"
                    type="number"
                    placeholder="Ejem: 1000"
                    class="kingdom-filter-input-sidebar"
                  />
                </div>
              </div>
            </div>

            <div class="sidebar-section kingdom-summary">
              <h4 class="sidebar-subtitle">📊 Resumen</h4>
              <p>Total Feudos: <strong>{{ fiefsTotalCount }}</strong></p>
              <p>Pob. Total: <strong>{{ formatNumber(myFiefs.reduce((acc, f) => acc + Number(f.population || 0), 0)) }}</strong></p>
            </div>
          </div>

          <!-- Territories Table (Enhanced for Fullscreen) -->
          <div v-if="activeKingdomTab === 'fiefs'" class="kingdom-table-wrapper">
            <KingdomPanel
              :fiefs="filteredAndSortedFiefs"
              :total="fiefsTotalCount"
              :page="fiefsPage"
              :limit="fiefsLimit"
              :playerGold="playerGold"
              :explorationConfig="explorationConfig"
              :workerTypes="workerTypes"
              @focusOnFief="focusOnFiefAndClose"
              @exploreFief="exploreFiefFromTable"
              @openRecruitment="openRecruitmentForFief"
              @openConstruction="openBuildModal"
              @openUpgrade="(data) => openUpgradeModal(data.h3_index, data.upgrade)"
              @upgradeFarm="handleUpgradeFarmFromTable"
              @buyWorker="handleBuyWorkerFromTable"
              @change-page="handleFiefsPageChange"
              @change-limit="handleFiefsLimitChange"
            />
          </div>

          <!-- Edictos Tab -->
          <div v-if="activeKingdomTab === 'divisions'" class="divisions-panel">
            <DivisionsTab />
          </div>

          <!-- Military Recruitment Tab -->
          <div v-if="activeKingdomTab === 'military'" class="military-recruitment-panel">
            <MilitaryPanel
              :fief="selectedRecruitmentFief"
              :unitTypes="unitTypes"
              :loading="loadingUnitTypes"
              :playerGold="playerGold"
              :isRecruiting="isRecruiting"
              :armyCount="armyCount"
              :armyLimit="armyLimit"
              :recruitablePool="recruitablePool"
              :playerCultureId="currentUser?.culture_id ?? null"
              @bulkRecruit="handleRecruitmentEmit"
              @back="activeKingdomTab = 'fiefs'"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Full-Screen Troops Overlay -->
    <div v-if="activeOverlay === 'troops'" class="game-overlay title-overlay">
      <div class="overlay-container">
        <!-- Header -->
        <div class="overlay-header">
          <h1 class="overlay-title">⚔️ Panel de Tropas</h1>
          <button class="overlay-close" @click="closeOverlay" title="Cerrar">✕</button>
        </div>

        <!-- Troops Content -->
        <div class="overlay-content troops-content">
          <TroopsPanel
            :armies="armies"
            :loading="loadingTroops"
            :playerCultureId="currentUser?.culture_id ?? null"
            @locate="handleLocateTroop"
            @armyStopped="handleArmyStopped"
            @armyStopFailed="(msg) => showToast(msg, 'error')"
            @armyAttacked="handleArmyAttacked"
            @armyAttackFailed="(msg) => showToast(msg, 'error')"
            @armyDismissed="handleArmyDismissed"
            @armiesTransferred="handleArmiesTransferred"
          />
        </div>
      </div>
    </div>

    <!-- Characters Overlay -->
    <div v-if="activeOverlay === 'characters'" class="game-overlay title-overlay">
      <div class="overlay-container">
        <div class="overlay-header">
          <h1 class="overlay-title">👑 Personajes y Dinastía</h1>
          <button class="overlay-close" @click="closeOverlay" title="Cerrar">✕</button>
        </div>
        <div class="overlay-content">
          <CharacterPanel :armies="armies" @refresh="fetchArmyData" @focus-hex="focusOnCharacterHex" />
        </div>
      </div>
    </div>

    <!-- Naval Overlay -->
    <div v-if="activeOverlay === 'naval'" class="game-overlay title-overlay">
      <div class="overlay-container">
        <div class="overlay-header">
          <h1 class="overlay-title">⛵ Flotas Navales</h1>
          <button class="overlay-close" @click="closeOverlay" title="Cerrar">✕</button>
        </div>
        <div class="overlay-content">
          <NavalPanel
            :key="newFleetId"
            :playerGold="playerGold"
            :playerCultureId="currentUser?.culture_id ?? null"
            :preselectedFleetId="newFleetId"
            @gold-updated="onGoldUpdated"
            @refresh="fetchArmyData"
          />
        </div>
      </div>
    </div>

    <!-- Building Construction Modal -->
    <div v-if="showBuildModal" class="build-modal-overlay" @click.self="closeBuildModal">
      <div class="build-modal">
        <div class="build-modal-header">
          <h2 class="build-modal-title">🏗️ Construir Edificio</h2>
          <button class="build-modal-close" @click="closeBuildModal" title="Cerrar">✕</button>
        </div>
        <p class="build-modal-subtitle">Feudo: <span class="build-modal-h3">{{ buildModalH3 }}</span></p>

        <div v-if="!buildModalHasWorker" class="build-worker-warning">
          ⛏️ Necesitas un constructor en este feudo para iniciar la obra
        </div>

        <div class="build-cards-grid">
          <div
            v-for="building in buildModalBuildings"
            :key="building.id"
            class="build-card"
            :class="{
              'build-card-disabled': playerGold < building.gold_cost,
              'build-card-prereq': building.required_building_id
            }"
          >
            <div class="build-card-icon">{{ getBuildingIcon(building.name, building.type_name) }}</div>
            <div class="build-card-info">
              <h3 class="build-card-name">{{ building.name }}</h3>
              <p v-if="building.type_name" class="build-card-type">{{ { military: 'Militar', religious: 'Religioso', economic: 'Económico', maritime: 'Marítimo', other: 'Otro' }[building.type_name] || building.type_name }}</p>
              <p v-if="building.description" class="build-card-desc">{{ building.description }}</p>
              <div class="build-card-stats">
                <span class="build-stat">💰 {{ building.gold_cost }}</span>
                <span class="build-stat">⏱️ {{ building.construction_time_turns }}t</span>
              </div>
            </div>
            <button
              class="build-card-btn"
              :disabled="playerGold < building.gold_cost || isConstructing || !buildModalHasWorker"
              :title="playerGold < building.gold_cost ? `Oro insuficiente (necesitas ${building.gold_cost} 💰)` : !buildModalHasWorker ? 'Necesitas un constructor en este feudo' : `Construir ${building.name}`"
              @click="doConstruct(buildModalH3, building.id)"
            >
              {{ isConstructing ? '...' : 'Construir' }}
            </button>
          </div>
        </div>

        <div v-if="buildModalBuildings.length === 0" class="build-empty">
          No hay edificios disponibles.
        </div>
      </div>
    </div>

    <!-- Building Upgrade Modal -->
    <div v-if="showUpgradeModal" class="build-modal-overlay" @click.self="closeUpgradeModal">
      <div class="build-modal">
        <div class="build-modal-header">
          <h2 class="build-modal-title">🏰 Ampliar Edificio</h2>
          <button class="build-modal-close" @click="closeUpgradeModal" title="Cerrar">✕</button>
        </div>
        <p class="build-modal-subtitle">Feudo: <span class="build-modal-h3">{{ upgradeModalH3 }}</span></p>

        <div v-if="!upgradeModalHasWorker" class="build-worker-warning">
          ⛏️ Necesitas un constructor en este feudo para ampliar el edificio
        </div>

        <div v-if="upgradeModalBuilding" class="upgrade-preview">
          <div class="build-card upgrade-card">
            <div class="build-card-icon">{{ getBuildingIcon(upgradeModalBuilding.name) }}</div>
            <div class="build-card-info">
              <h3 class="build-card-name">{{ upgradeModalBuilding.name }}</h3>
              <p class="build-card-type">Mejora del edificio actual</p>
              <div class="build-card-stats">
                <span class="build-stat">💰 {{ upgradeModalBuilding.gold_cost }}</span>
                <span class="build-stat">⏱️ {{ upgradeModalBuilding.turns }}t</span>
              </div>
            </div>
            <button
              class="build-card-btn"
              :disabled="playerGold < upgradeModalBuilding.gold_cost || isUpgrading || !upgradeModalHasWorker"
              :title="playerGold < upgradeModalBuilding.gold_cost ? `Oro insuficiente (necesitas ${upgradeModalBuilding.gold_cost} 💰)` : !upgradeModalHasWorker ? 'Necesitas un constructor en este feudo' : `Ampliar a ${upgradeModalBuilding.name}`"
              @click="doUpgrade"
            >
              {{ isUpgrading ? '...' : 'Ampliar' }}
            </button>
          </div>
          <p v-if="playerGold < upgradeModalBuilding.gold_cost" class="upgrade-warning">
            ⚠️ Necesitas {{ upgradeModalBuilding.gold_cost - playerGold }} 💰 más para esta ampliación
          </p>
        </div>
      </div>
    </div>

    <!-- Toast Notifications Container -->
    <div class="toast-container">
      <div
        v-for="(toast, index) in toasts"
        :key="toast.id"
        :class="['toast', `toast-${toast.type}`, toast.isLeaving ? 'toast-leaving' : '']"
      >
        <span class="toast-icon">{{ getToastIcon(toast.type) }}</span>
        <span class="toast-message">{{ toast.message }}</span>
      </div>
    </div>

    <!-- Full-Screen Diplomacy Overlay -->
    <div v-if="activeOverlay === 'diplomacy'" class="game-overlay title-overlay">
      <div class="overlay-container">
        <div class="overlay-header">
          <h1 class="overlay-title">⚖️ Diplomacia</h1>
          <button class="overlay-close" @click="closeOverlay" title="Cerrar">✕</button>
        </div>
        <div class="overlay-content">
          <DiplomacyPanel
            :myPlayerId="currentUser?.player_id"
            :myCultureId="currentUser?.culture_id ?? null"
            @refresh="fetchPendingRelations"
          />
        </div>
      </div>
    </div>

    <!-- Full-Screen Economy Overlay -->
    <EconomyPanel
      v-if="activeOverlay === 'economy'"
      :playerCultureId="currentUser?.culture_id ?? null"
      @close="closeOverlay"
      @gold-updated="onGoldUpdated"
    />

    <!-- Battle Summary Modal -->
    <BattleSummaryModal
      :show="battleSummaryVisible"
      :battle="battleSummaryData"
      @close="battleSummaryVisible = false"
    />

    <!-- Army Transfer Panel (opened from map popup split button) -->
    <ArmyTransferPanel
      :show="showTransferPanel"
      :armyAId="transferPanelArmyAId"
      :armyBId="transferPanelArmyBId"
      :h3_index="transferPanelHex"
      :fiefName="transferPanelFiefName"
      @close="showTransferPanel = false"
      @done="handleArmiesTransferred"
    />

    <!-- Epic Initialization Panel (first-time players only) -->
    <WelcomePanel
      v-if="showWelcomePanel"
      @done="onInitDone"
    />

    <!-- Edictos Panel -->
    <FueroPanel
      v-if="showFueroPanel"
      :h3_index="fueroPanelH3"
      :fiefName="fueroPanelFiefName"
      :gender="currentUser?.gender || 'M'"
      @close="showFueroPanel = false; clearDivisionHighlights()"
      @highlight-fiefs="highlightDivisionFiefs"
      @clear-highlights="clearDivisionHighlights"
      @division-proclaimed="onDivisionProclaimed"
    />

  <!-- Aviso staging -->
  <div v-if="showStagingNotice" class="staging-notice-overlay">
    <div class="staging-notice-box">
      <div class="staging-notice-icon">⚠️</div>
      <h2 class="staging-notice-title">Entorno de pruebas</h2>
      <ul class="staging-notice-list">
        <li>Este juego está en desarrollo activo y puede cambiar sin previo aviso.</li>
        <li>Los datos de partida pueden resetearse en cualquier momento.</li>
        <li>Los turnos están acelerados a <strong>10 minutos</strong> para facilitar las pruebas.</li>
      </ul>
      <a
        href="https://www.notion.so/Manual-de-Juego-326c5a6157a28107b01edc275cd89f21"
        target="_blank"
        rel="noopener"
        class="staging-notice-manual"
      >📖 Ver Manual de Juego</a>
      <button class="staging-notice-btn" @click="showStagingNotice = false">Entendido</button>
    </div>
  </div>

  </div>

  <!-- Changelog Panel (fuera del sidebar para evitar clipping por transform) -->
  <ChangelogPanel v-if="showChangelog" @close="showChangelog = false" />

</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import L from 'leaflet';
import { cellToBoundary, cellToLatLng, gridDistance, gridPathCells, latLngToCell } from 'h3-js';
import 'leaflet/dist/leaflet.css';

// Import map utilities
import { getHexagonStyles } from '@/utils/mapStyles.js';
import { generateCellPopupContent, generateArmyPopup } from '@/utils/PopupGenerator.js';
import MapInteractionController from '@/utils/MapInteractionController.js';
import RouteVisualizer from '@/utils/RouteVisualizer.js';
import { createStackerDivIcon, advanceNavIdx } from '@/utils/HexStacker.js';

// Import API service
import * as mapApi from '@/services/mapApi.js';

// Import modular components
import KingdomPanel from './KingdomPanel.vue';
import MilitaryPanel from './MilitaryPanel.vue';
import TroopsPanel from './TroopsPanel.vue';
import NotificationsPanel from './NotificationsPanel.vue';
import BattleSummaryModal from './BattleSummaryModal.vue';
import EconomyPanel from './EconomyPanel.vue';
import AdminPanel from './AdminPanel.vue';
import ArmyTransferPanel from './ArmyTransferPanel.vue';
import WelcomePanel from './WelcomePanel.vue';
import FueroPanel from './FueroPanel.vue';
import DivisionsTab from './DivisionsTab.vue';
import CharacterPanel from './CharacterPanel.vue';
import DiplomacyPanel from './DiplomacyPanel.vue';
import NavalPanel from './NavalPanel.vue';
import ChangelogPanel from './ChangelogPanel.vue';

const mapContainer = ref(null);
const loading = ref(false);
const error = ref(null);
const hexagonCount = ref(0);
const hexagonOpacity = ref(parseInt(localStorage.getItem('feudos_transparency') ?? '40', 10));
const currentZoom = ref(13);
const currentResolution = ref(7); // H3 resolution
const terrainTypes = ref([]);
const showH3Layer = ref(true);
const showTerrainLayer = ref(true); // Terrain layer visibility
const isPoliticalView = ref(true); // Vista política para resaltar territorios de jugadores (activada por defecto)
const mouseH3Index = ref(''); // H3 index under cursor

// Player state (from session)
const currentUser = ref(null);       // Current logged-in user { player_id, username, role }
const showWelcomePanel = ref(false); // Epic Initialization overlay for new players
const showChangelog = ref(false);
const playerId = computed(() => currentUser.value?.player_id || 1); // Player ID from session
const playerGold = ref(0); // Oro inicial (se carga del servidor)
const playerHexes = ref(new Set()); // Track player's owned hexagons for adjacency checks
const explorationConfig = ref({ turns_required: 5, gold_cost: 100 }); // Configuración de exploración

// World state (turn and date)
const currentTurn = ref(1);
const gameDate = ref({ day: 1, month: 1, year: 210, era: 'BC' });
const formattedDate = ref('1 de marzo de 1039');

// Day of year based on current turn (1-365)
const dayOfYear = computed(() => {
  return ((currentTurn.value - 1) % 365) + 1;
});

// Computed property for next harvest information
const nextHarvestLabel = computed(() => {
  const day = dayOfYear.value;

  if (day <= 76) {
    // Before spring harvest
    const daysUntil = 76 - day;
    return `Próxima cosecha: Primavera en ${daysUntil} días`;
  } else if (day <= 184) {
    // Before summer harvest
    const daysUntil = 184 - day;
    return `Próxima cosecha: Verano en ${daysUntil} días`;
  } else {
    // After summer harvest, next is spring of next year
    const daysUntil = 76 + 365 - day;
    return `Próxima cosecha: Primavera en ${daysUntil} días`;
  }
});

// Fiefs monitoring
const myFiefs = ref([]);
const loadingFiefs = ref(false);
let previousFoodValues = {}; // Track food values for highlight animation

// Messages state
const myMessages = ref([]);
const loadingMessages = ref(false);
const selectedMessage = ref(null); // Currently selected message for detail view
const threadMessages = ref([]); // Messages in the current thread
const unreadCount = computed(() => myMessages.value.filter(m => !m.is_read && m.receiver_id === playerId.value).length);
const unreadNotifCount = computed(() => notifications.value.filter(n => !n.is_read).length);
const pendingRelationsCount = ref(0);
const messageFilter = ref('received'); // 'received', 'sent', 'all'

// Filtered messages based on current tab
const filteredMessages = computed(() => {
  if (messageFilter.value === 'received') {
    return myMessages.value.filter(m => m.receiver_id === playerId.value);
  } else if (messageFilter.value === 'sent') {
    return myMessages.value.filter(m => m.sender_id === playerId.value);
  }
  return myMessages.value;
});

// Message composition state
const messageRecipient = ref('');
const messageSubject = ref('');
const messageBody = ref('');
const sendingMessage = ref(false);
const parentMessage = ref(null); // Stores the message being replied to

// Server synchronization state
const SYNC_INTERVAL = 30000; // Poll server every 30 seconds
let syncIntervalId = null;
let lastSyncTime = null;

// Army popup pagination state
let _pp_armies = [];
let _pp_items  = [];   // combined: [{ type:'army'|'character', data }]
let _pp_index = 0;
let _pp_ref = null;
let _pp_h3 = '';
let _pp_coords = { x: null, y: null, ownerId: null };
let _char_cache       = []; // own characters — updated in fetchAndRenderCharacters
let _enemy_char_cache = []; // visible enemy characters — updated in fetchAndRenderCharacters
let _all_fleets       = []; // own fleets — updated in fetchHexagonData

// Stacker render caches — kept so fetchAndRenderCharacters can re-render stackers
let _cachedBuildings       = [];
let _cachedArmies          = [];
let _cachedWorkers         = [];
let _cachedCurrentPlayerId = null;
let _cachedOwnerMap        = new Map();
// Map: h3_index → Leaflet marker, for icon updates after nav-arrow clicks
let _hexStackerMarkers     = new Map();

// Action panel state
const showActionPanel = ref(false);
const selectedHexData = ref(null);
const actionPanelPosition = ref({ x: 0, y: 0 });

// Navigation search state
const searchH3Input = ref('');
const capitalH3Index = ref(null); // Cache capital location
const isExiled = ref(false);      // True when the player has no territories (exile state)

// Kingdom management state
const kingdomFilters = ref({
  name: '',
  maxPopulation: null,
  division: '',
});
const myDivisions = ref([]); // Player's señoríos for the filter dropdown

// Fiefs pagination state (server-side)
const fiefsPage       = ref(1);
const fiefsLimit      = ref(10);
const fiefsTotalCount = ref(0);

// Re-fetch from page 1 whenever filters change
watch(kingdomFilters, () => {
  fiefsPage.value = 1;
  updateFiefsUI({ page: 1 });
}, { deep: true });

// Military recruitment state
const activeKingdomTab = ref('fiefs'); // 'fiefs' or 'military'
const unitTypes = ref([]);
const loadingUnitTypes = ref(false);
const selectedRecruitmentFief = ref(null);
const recruitablePool = ref(null);
const selectedUnitType = ref(null);
const recruitmentQuantity = ref(1);
const recruitmentArmyName = ref('');
const recruitmentMessage = ref({ type: '', text: '' });
const isRecruiting = ref(false);
const isColonizing = ref(false); // Track colonization state to prevent multiple simultaneous colonizations
const workerTypes = ref([]);    // Loaded once on mount from /api/workers/types
const myWorkers = ref([]);       // Player's hired workers (shown in market panel)
const loadingWorkers = ref(false);

// Mobile menu
const showMobileMenu = ref(false);

// Market panel state
const marketHireTypeId = ref(null);
const marketHireH3 = ref(null);
const workerHireLocations = ref([]);

const workerTypeIcon = (name) => {
  const icons = { constructor: '⛏️', farmer: '🌾', miner: '⛰️', lumberjack: '🪵', merchant: '🛒' };
  return icons[name?.toLowerCase()] ?? '👷';
};
const marketFoodAmount = ref(100);

const loadWorkerHireLocations = async () => {
  try {
    const data = await mapApi.getWorkerHireLocations();
    workerHireLocations.value = data.locations || [];
  } catch (e) {
    console.error('[Market] Error cargando ubicaciones de contratación', e);
    workerHireLocations.value = [];
  }
};

// Building construction modal state
const showBuildModal = ref(false);
const buildModalH3 = ref(null);
const buildModalBuildings = ref([]);
const isConstructing = ref(false);
const buildModalOpenedFromWorker = ref(false); // true when modal opened directly from worker card
const buildModalHasWorker = computed(() => buildModalOpenedFromWorker.value || myWorkers.value.some(w => w.h3_index === buildModalH3.value));

// Building upgrade modal state
const showUpgradeModal = ref(false);
const upgradeModalH3 = ref(null);
const upgradeModalBuilding = ref(null);
const isUpgrading = ref(false);
const upgradeModalHasWorker = computed(() => myWorkers.value.some(w => w.h3_index === upgradeModalH3.value));

// Troops panel state
const armies = ref([]);
const loadingTroops = ref(false);

// Army capacity (limit based on fief count)
const armyCount = ref(0);
const armyLimit = ref(2);

// Notifications panel state
const notifications = ref([]);
const loadingNotifications = ref(false);
let notifPollIntervalId = null;
const NOTIF_POLL_INTERVAL = 45_000; // 45 segundos

// Profile panel state
const profileDisplayName = ref('');
const savingProfile = ref(false);

// Battle summary modal state
const battleSummaryVisible = ref(false);
const battleSummaryData = ref({});

// Transfer panel state (opened from map popup)
const showTransferPanel      = ref(false);
const transferPanelArmyAId   = ref(null);
const transferPanelArmyBId   = ref(null);
const transferPanelHex       = ref('');
const transferPanelFiefName  = ref('');

// Edictos panel state
const showFueroPanel    = ref(false);
const fueroPanelH3      = ref('');
const fueroPanelFiefName = ref('');

// Legend toggle state
const legendCollapsed = ref(true); // Collapsed by default

// Panel system state
const activePanel = ref(null); // Currently open panel: 'layers', 'market', 'notifications', 'profile'
const panelTitle = computed(() => {
  const titles = {
    economy: '💰 Economía',
    layers: '🗺️ Capas del Mapa',
    troops: '⚔️ Tropas',
    market: '⚖️ Mercado',
    kingdom: '🏰 Imperium',
    messages: '📜 Mensajes',
    notifications: '🔔 Notificaciones',
    profile: '👤 Perfil'
  };
  return titles[activePanel.value] || '';
});

// Overlay system state (full-screen overlays like Messages)
const activeOverlay = ref(null); // 'messages', 'fiefs', etc.
const newFleetId    = ref(null); // fleet_id to auto-expand when naval panel opens
const showStagingNotice = ref(false);

// Infinite scroll for fiefs (Kingdom panel)
const FIEFS_PER_PAGE = 20;
const displayedFiefsCount = ref(FIEFS_PER_PAGE);
const loadingMoreFiefs = ref(false);
const displayedFiefs = computed(() => {
  return myFiefs.value.slice(0, displayedFiefsCount.value);
});

// Filtered and sorted fiefs for Kingdom Management panel
const filteredAndSortedFiefs = computed(() => {
  if (!myFiefs.value || myFiefs.value.length === 0) return [];

  // Calculate enriched fief data with distance and autonomy
  let enrichedFiefs = myFiefs.value.map(fief => {
    const population = Number(fief.population || 0);
    const happiness      = Number(fief.happiness       || 0);
    const happinessDelta = Number(fief.happiness_delta ?? 0);
    const food = Number(fief.food_stored || 0);
    const wood = Number(fief.wood_stored || 0);
    const stone = Number(fief.stone_stored || 0);
    const iron = Number(fief.iron_stored || 0);
    const gold = Number(fief.gold_stored || 0);
    const fertility = Number(fief.fertility || 0);

    // Daily food consumption matches backend formula (turn_engine.js:195)
    const consumption = Math.floor(population / 100.0) * FOOD_CONSUMPTION_MULTIPLIER;
    const autonomy = consumption > 0 ? Math.floor(food / consumption) : Infinity;
    
    // Food balance estimated: daily production probability (1.185 avg) - consumption
    // We use a base of 1.185 from the weighted average of harvests
    const estimatedDailyYield = consumption * 1.185;
    const foodBalance = estimatedDailyYield - consumption;

    // Determine exploration status
    const isExplored = fief.discovered_resource !== null && fief.discovered_resource !== undefined;
    const isExploring = fief.exploration_end_turn !== null && !isExplored;
    let explorationStatus, explorationStatusIcon, explorationStatusShort, explorationStatusText;

    if (isExplored) {
      explorationStatus = 'completed';
      explorationStatusIcon = '✅';
      const resourceNames = {
        'stone': '⛰️ Piedra',
        'iron': '⛏️ Hierro',
        'gold': '💛 Oro',
        'none': '❌'
      };
      explorationStatusShort = resourceNames[fief.discovered_resource] || '✅';
      explorationStatusText = `Explorado - ${resourceNames[fief.discovered_resource] || 'Sin recursos'}`;
    } else if (isExploring) {
      explorationStatus = 'exploring';
      explorationStatusIcon = '⏳';
      const turnsRemaining = (fief.exploration_end_turn && currentTurn.value)
        ? Math.max(0, fief.exploration_end_turn - currentTurn.value)
        : '?';
      explorationStatusShort = `${turnsRemaining}t`;
      explorationStatusText = `Explorando... (Faltan ${turnsRemaining} turno${turnsRemaining !== 1 ? 's' : ''})`;
    } else {
      explorationStatus = 'pending';
      explorationStatusIcon = '⚪';
      explorationStatusShort = 'Sin explorar';
      explorationStatusText = 'Sin explorar - Clic para iniciar exploración';
    }

    // Determine low stock status (no depletion, resources are permanent)
    let miningStatus = null;
    let miningStatusIcon = '';
    let miningStatusText = '';

    if (isExplored && fief.discovered_resource !== 'none') {
      if (fief.discovered_resource === 'stone') {
        const stoneAmount = Number(fief.stone_stored || 0);
        if (stoneAmount > 0 && stoneAmount < 100) {
          miningStatus = 'low';
          miningStatusIcon = '⚠️';
          miningStatusText = 'Stock bajo';
        }
      } else if (fief.discovered_resource === 'iron') {
        const ironAmount = Number(fief.iron_stored || 0);
        if (ironAmount > 0 && ironAmount < 100) {
          miningStatus = 'low';
          miningStatusIcon = '⚠️';
          miningStatusText = 'Stock bajo';
        }
      } else if (fief.discovered_resource === 'gold') {
        const goldAmount = Number(fief.gold_stored || 0);
        if (goldAmount > 0 && goldAmount < 0.5) {
          miningStatus = 'low';
          miningStatusIcon = '⚠️';
          miningStatusText = 'Stock bajo';
        }
      }
    }

    // Build name with coordinates
    let baseName = fief.location_name || fief.h3_index?.substring(0, 8) || 'Territorio';
    let nameWithCoords = baseName;
    if (fief.coord_x !== null && fief.coord_x !== undefined && fief.coord_y !== null && fief.coord_y !== undefined) {
      nameWithCoords = `${baseName} (${fief.coord_x}, ${fief.coord_y})`;
    }

    return {
      h3_index: fief.h3_index,
      name: nameWithCoords,
      terrain: fief.terrain_name || 'Desconocido',
      population,
      happiness,
      happiness_delta: happinessDelta,
      food,
      wood,
      stone,
      iron,
      gold,
      foodBalance,
      fertility,
      consumption,
      autonomy,
      explorationStatus,
      explorationStatusIcon,
      explorationStatusShort,
      explorationStatusText,
      total_troops: fief.total_troops || 0,
      discovered_resource: fief.discovered_resource,
      exploration_end_turn: fief.exploration_end_turn,
      miningStatus,
      miningStatusIcon,
      miningStatusText,
      grace_turns: Number(fief.grace_turns || 0),
      is_capital: fief.is_capital || false,
      fief_building: fief.fief_building || null,
      can_recruit: fief.can_recruit || false,
      farm_level: Number(fief.farm_level || 0),
      food_output: Number(fief.food_output || 0),
      division_name: fief.division_name || null,
    };
  });

  return enrichedFiefs;
});

// Toast notifications state
const toasts = ref([]);
let toastIdCounter = 0;

let map = null;
let hexagonLayer = null;
let settlementMarkersLayer = null;
let settlementMarkersMap = {}; // Map: settlement name -> marker
let buildingMarkersLayer = null; // Layer for capital crown markers
let fiefIconsLayer = null;       // Layer for fief building icons (API-driven)
let armyMarkersLayer = null;    // Layer for army/troop icons
let workersMarkersLayer = null;       // Layer for worker icons
let fleetMarkersLayer   = null;       // Layer for own naval fleet icons
let constructionMarkersLayer = null;  // Layer for in-progress bridge constructions
let hexStackerLayer = null;           // Layer for combined HexStacker markers (owner+building+troops)
let highlightLayer = null; // Temporary highlight polygon for navigation
let divisionHighlightLayer = null; // Gold overlay for division fief selection
let divisionBoundaryLayer = null;  // Political division borders (GeoJSON)
let characterMarkersLayer = null;  // Character icons on the map
let debounceTimer = null;
let lastLoadedBounds = null; // bounds at the time of last data fetch

// Configuration
const MIN_ZOOM = 9; // Zoom mínimo del mapa
const MIN_ZOOM_H3 = 11; // Hexágonos visibles desde zoom 11
const MAX_ZOOM_H3 = 17; // Hexágonos visibles hasta zoom 17
const MIN_ZOOM_SETTLEMENTS = 12; // Mostrar asentamientos solo a partir de zoom 12
const LEON_CENTER = [42.599, -5.573];
const INITIAL_ZOOM = 13;
const DEBOUNCE_DELAY = 500; // ms
// Minimum fraction of the current viewport that must be "new" to trigger a reload.
// 0.20 = reload only when at least 20% of the current view was not previously loaded.
const EXTENT_CHANGE_THRESHOLD = 0.20;
// REMOVED: ZOOM_THRESHOLD_RES_10 - Now resolution is always 8 (database only has res 8 indices)

// Game mechanics constants
const FOOD_CONSUMPTION_MULTIPLIER = 0.1; // Daily food consumption = (population / 100) * this value

/**
 * Leer parámetros de la URL (lat, lng, zoom, res)
 * Retorna objeto con las coordenadas, zoom y resolución, o null si no existen
 */
const getURLParams = () => {
  const params = new URLSearchParams(window.location.search);
  const lat = params.get('lat');
  const lng = params.get('lng');
  const zoom = params.get('zoom');
  const res = params.get('res');

  if (lat && lng && zoom) {
    return {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      zoom: parseInt(zoom, 10),
      res: res ? parseInt(res, 10) : null // Resolución opcional
    };
  }
  return null;
};

/**
 * Actualizar la URL del navegador con las coordenadas, zoom y resolución actuales
 * Usa history.replaceState para no crear entradas en el historial
 */
const updateURLParams = () => {
  if (!map) return;

  const center = map.getCenter();
  const zoom = map.getZoom();

  // Redondear coordenadas a 5 decimales
  const lat = center.lat.toFixed(5);
  const lng = center.lng.toFixed(5);

  // Construir nueva URL incluyendo resolución
  const newURL = `${window.location.pathname}?lat=${lat}&lng=${lng}&zoom=${zoom}&res=${currentResolution.value}`;

  // Actualizar URL sin recargar la página
  window.history.replaceState({}, '', newURL);
};

// Base map layers
let reliefLayer = null;
let smoothLayer = null;
let referenceLayer = null;

/**
 * Initialize Leaflet map
 * Priority: 1) Player capital, 2) URL params, 3) León default
 */
const initMap = () => {
  // Try to get player's capital from localStorage (set on login)
  const capitalH3 = localStorage.getItem('capitalH3');
  let center = LEON_CENTER;
  let zoom = INITIAL_ZOOM;

  if (capitalH3) {
    try {
      // Convert H3 index to lat/lng
      const [lat, lng] = cellToLatLng(capitalH3);
      center = [lat, lng];
      zoom = 11; // Close zoom to see the capital clearly
      console.log(`[Map Init] Centering on player's capital: ${capitalH3}`);

      // Clear the capital from localStorage after using it once
      localStorage.removeItem('capitalH3');
    } catch (error) {
      console.warn('[Map Init] Could not parse capital H3 index:', error);
    }
  }

  // Leer parámetros de la URL (override capital if URL params exist)
  const urlParams = getURLParams();
  if (urlParams) {
    center = [urlParams.lat, urlParams.lng];
    zoom = urlParams.zoom;
  }

  currentResolution.value = 7;

  console.log(`Initializing map at [${center[0]}, ${center[1]}], zoom ${zoom}, resolution ${currentResolution.value}`);

  map = L.map('map', {
    center: center,
    zoom: zoom,
    zoomControl: false,
  });

  // Add zoom control on the right side
  L.control.zoom({
    position: 'topright'
  }).addTo(map);

  // Add Home button control below zoom control
  const HomeControl = L.Control.extend({
    options: {
      position: 'topright'
    },
    onAdd: function(map) {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-home');
      const button = L.DomUtil.create('a', '', container);
      button.innerHTML = '🏰';
      button.href = '#';
      button.title = 'Ir a la Capital';
      button.setAttribute('role', 'button');
      button.setAttribute('aria-label', 'Ir a la Capital');

      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.on(button, 'click', function(e) {
        L.DomEvent.preventDefault(e);
        goToCapital();
      });

      return container;
    }
  });

  new HomeControl().addTo(map);

  // Create custom Panes to ensure correct stacking order
  // Territory Pane (Fill) - Bottom
  map.createPane('territoryPane');
  map.getPane('territoryPane').style.zIndex = 400;

  // Border Pane (Lines) - Middle
  map.createPane('borderPane');
  map.getPane('borderPane').style.zIndex = 450;

  // Star Pane (Icons) - Top
  map.createPane('starPane');
  map.getPane('starPane').style.zIndex = 650;

  // Building Pane (Building Icons) - Below army icons
  map.createPane('buildingPane');
  map.getPane('buildingPane').style.zIndex = 660;

  // Worker Pane (Worker Icons) - Below army pane
  map.createPane('workerPane');
  map.getPane('workerPane').style.zIndex = 665;

  map.createPane('fleetPane');
  map.getPane('fleetPane').style.zIndex = 678;

  // Construction Pane (in-progress bridges) - above workers
  map.createPane('constructionPane');
  map.getPane('constructionPane').style.zIndex = 668;

  // Army Pane (Troop Icons) - Below popupPane (700) so popups always render on top
  map.createPane('armyPane');
  map.getPane('armyPane').style.zIndex = 680;

  // Stacker Pane (HexStacker combined icons) - same tier as army, above building pane
  map.createPane('stackerPane');
  map.getPane('stackerPane').style.zIndex = 675;

  // Division Border Pane — above hex borders (450), below all icons (650)
  map.createPane('divisionBorderPane');
  map.getPane('divisionBorderPane').style.zIndex = 460;
  map.getPane('divisionBorderPane').style.pointerEvents = 'auto';

  // Inicializar visualizador de rutas (crea su propio pane routePane z-600)
  RouteVisualizer.init(map);

  // Esri World Shaded Relief — ideal para temática medieval (sin infraestructura moderna)
  reliefLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Tiles © Esri',
      maxZoom: 13,
    }
  );

  // Esri World Physical Map — relieve físico mudo, sin etiquetas modernas
  // maxNativeZoom=8 permite upscaling: encaja con filtro sepia como mapa antiguo
  smoothLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: '© Esri',
      maxNativeZoom: 8,
      maxZoom: 16,
    }
  );

  // Referencia: satélite Esri + overlay de etiquetas/fronteras (para orientación)
  referenceLayer = L.layerGroup([
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri', maxZoom: 19 }
    ),
    L.tileLayer(
      'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { attribution: '', maxZoom: 19, opacity: 0.85 }
    ),
  ]);

  // Add Relief layer as default
  reliefLayer.addTo(map);

  // Layer control
  const baseMaps = {
    'Relieve': reliefLayer,
    'Físico': smoothLayer,
    'Referencia': referenceLayer,
  };
  L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);

  // Create a layer group for hexagons with canvas renderer for better performance
  hexagonLayer = L.layerGroup({ renderer: L.canvas() }).addTo(map);

  // Create separate layers for markers
  settlementMarkersLayer = L.layerGroup().addTo(map);
  buildingMarkersLayer = L.layerGroup().addTo(map);
  fiefIconsLayer = L.layerGroup().addTo(map);
  armyMarkersLayer = L.layerGroup().addTo(map);
  workersMarkersLayer = L.layerGroup().addTo(map);
  fleetMarkersLayer   = L.layerGroup().addTo(map);
  constructionMarkersLayer = L.layerGroup().addTo(map);
  hexStackerLayer = L.layerGroup().addTo(map);
  divisionHighlightLayer = L.layerGroup().addTo(map);
  divisionBoundaryLayer = L.layerGroup().addTo(map);

  // Character pane — above armies (680) so the icon is always visible
  map.createPane('characterPane');
  map.getPane('characterPane').style.zIndex = 685;
  characterMarkersLayer = L.layerGroup().addTo(map);

  // Track zoom level
  currentZoom.value = map.getZoom();

  // Event listeners
  map.on('moveend', handleMapMove);
  map.on('zoomend', handleZoomChange);

  // Track mouse position for H3 index telemetry
  map.on('mousemove', (e) => {
    try {
      const h3Index = latLngToCell(e.latlng.lat, e.latlng.lng, currentResolution.value);
      mouseH3Index.value = h3Index;
    } catch (error) {
      mouseH3Index.value = '';
    }
  });

  // Clear H3 index when mouse leaves map
  map.on('mouseout', () => {
    mouseH3Index.value = '';
  });

  // Clean up highlight when popup closes
  map.on('popupclose', () => {
    if (highlightLayer) {
      map.removeLayer(highlightLayer);
      highlightLayer = null;
    }
  });

  // Initial load
  loadHexagonsIfZoomValid();
  fetchPlayerData();
  fetchAndRenderCharacters();
};

/**
 * Handle map movement (with debouncing)
 * Actualiza hexágonos y URL del navegador
 */
/**
 * Returns the fraction of `newBounds` area that is NOT covered by `oldBounds`.
 * 0 = identical view, 1 = completely new area.
 */
const extentChangeFraction = (oldBounds, newBounds) => {
  if (!oldBounds) return 1; // no previous load → always reload

  const iW = Math.max(0, Math.min(oldBounds.getEast(),  newBounds.getEast())
                       - Math.max(oldBounds.getWest(),  newBounds.getWest()));
  const iH = Math.max(0, Math.min(oldBounds.getNorth(), newBounds.getNorth())
                       - Math.max(oldBounds.getSouth(), newBounds.getSouth()));
  const intersection = iW * iH;

  const nW = newBounds.getEast()  - newBounds.getWest();
  const nH = newBounds.getNorth() - newBounds.getSouth();
  const newArea = nW * nH;

  if (newArea <= 0) return 1;
  return 1 - (intersection / newArea); // fraction of new view that is "new"
};

const handleMapMove = () => {
  // Clear previous timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Set new timer
  debounceTimer = setTimeout(() => {
    updateURLParams(); // Actualizar URL con nueva posición

    if (!showH3Layer.value) return;

    const currentBounds = map.getBounds();
    const changeFraction = extentChangeFraction(lastLoadedBounds, currentBounds);

    if (changeFraction < EXTENT_CHANGE_THRESHOLD) return; // < 20% new area, skip reload

    loadHexagonsIfZoomValid();
  }, DEBOUNCE_DELAY);
};

/**
 * Handle zoom change
 * - Resolution is always 6 (database only contains res 6 indices)
 * - Hexagons visible between zoom 11-17
 * - Zoom < 12: Oculta asentamientos
 * - Zoom >= 12: Muestra asentamientos
 */
const handleZoomChange = () => {
  const previousZoom = currentZoom.value;
  currentZoom.value = map.getZoom();

  // Verificar si cruzamos el umbral de visualización de asentamientos
  const wasShowingSettlements = previousZoom >= MIN_ZOOM_SETTLEMENTS;
  const shouldShowSettlements = currentZoom.value >= MIN_ZOOM_SETTLEMENTS;

  // Always reload hexagons if zoom is valid (no resolution changes)
  loadHexagonsIfZoomValid();

  // Manejar visibilidad de asentamientos según zoom
  if (wasShowingSettlements !== shouldShowSettlements) {
    if (!shouldShowSettlements) {
      console.log(`Zoom ${currentZoom.value}: Hiding settlements (zoom < ${MIN_ZOOM_SETTLEMENTS})`);
      clearSettlementMarkers();
    } else {
      console.log(`Zoom ${currentZoom.value}: Showing settlements (zoom >= ${MIN_ZOOM_SETTLEMENTS})`);
      // Los asentamientos se renderizarán en loadHexagonsIfZoomValid
    }
  }
};

/**
 * Load hexagons only if zoom is within valid range (11-17)
 * Optimized to only show hexagons at appropriate zoom levels
 */
const loadHexagonsIfZoomValid = () => {
  const currentZoom = map.getZoom();
  if (currentZoom >= MIN_ZOOM_H3 && currentZoom <= MAX_ZOOM_H3) {
    lastLoadedBounds = map.getBounds(); // record extent before fetching
    fetchHexagonData();
  } else {
    // Clear hexagons and all map-bound markers if zoom is outside valid range
    clearHexagons();
    clearArmyMarkers();
    clearWorkerMarkers();
    clearConstructionMarkers();
    clearFiefIcons();
    clearHexStackers();
    if (currentZoom < MIN_ZOOM_H3) {
      console.log(`Hexágonos ocultos: zoom ${currentZoom} < ${MIN_ZOOM_H3}`);
    } else if (currentZoom > MAX_ZOOM_H3) {
      console.log(`Hexágonos ocultos: zoom ${currentZoom} > ${MAX_ZOOM_H3}`);
    }
  }
};

/**
 * Clear all hexagons from the map
 */
const clearHexagons = () => {
  if (hexagonLayer) {
    hexagonLayer.clearLayers();
    hexagonCount.value = 0;
  }
};

/**
 * Fetch hexagon data from backend API based on current map bounds and resolution
 */
const fetchHexagonData = async () => {
  try {
    loading.value = true;
    error.value = null;

    // Get current map bounds
    const bounds = map.getBounds();
    const params = {
      minLat: bounds.getSouth(),
      maxLat: bounds.getNorth(),
      minLng: bounds.getWest(),
      maxLng: bounds.getEast(),
      res: currentResolution.value, // Pasar resolución a la API
    };

    console.log(`Fetching hexagons at resolution ${currentResolution.value}...`);
    const hexagons = await mapApi.getMapRegion(params);

    hexagonCount.value = hexagons.length;
    renderHexagons(hexagons);

    // Build owner map from hexagon data: h3_index → { color, player_id }
    const ownerMap = new Map();
    for (const h of hexagons) {
      if (h.player_id) {
        ownerMap.set(h.h3_index, { color: h.player_color, player_id: h.player_id });
      }
    }

    // Draw movement routes (always, regardless of zoom)
    await fetchAndDrawRoutes();

    // Fetch buildings, armies, workers, constructions and own fleets in parallel
    const [buildingData, armyData, workerData, constructionData, fleetData] = await Promise.allSettled([
      mapApi.getMapBuildings(params),
      mapApi.getMapArmies(params),
      mapApi.getMapWorkers(params),
      mapApi.getMapConstructions(params),
      mapApi.getFleets(),
    ]);

    const buildings = buildingData.status === 'fulfilled' && buildingData.value.success
      ? buildingData.value.buildings
      : [];
    const armies = armyData.status === 'fulfilled' && armyData.value.success
      ? armyData.value.armies
      : [];
    const currentPlayerId = armyData.status === 'fulfilled'
      ? armyData.value.current_player_id
      : playerId.value;
    const workers = workerData.status === 'fulfilled' && workerData.value.success
      ? workerData.value.workers
      : [];
    const constructions = constructionData.status === 'fulfilled' && constructionData.value.success
      ? constructionData.value.constructions
      : [];
    const fleets = fleetData.status === 'fulfilled' && fleetData.value.success
      ? fleetData.value.fleets
      : [];

    // Cache for re-renders triggered by fetchAndRenderCharacters
    _cachedBuildings       = buildings;
    _cachedArmies          = armies;
    _cachedWorkers         = workers;
    _cachedCurrentPlayerId = currentPlayerId;
    _cachedOwnerMap        = ownerMap;

    // Render combined HexStacker icons (troops + workers + chars in one marker per hex)
    renderHexStackers(buildings, armies, workers, _char_cache, _enemy_char_cache, currentPlayerId, ownerMap);

    // Hexes where the own player already has land troops (fleet marker hidden there — accessible via nav popup)
    const hexesWithOwnTroops = new Set(
      armies
        .filter(e => e.player_id === currentPlayerId && Number(e.total_troops) > 0)
        .map(e => e.h3_index)
    );

    // Render own fleet markers (interactive: move, stop, embark, disembark)
    // Skip hexes that already show a land-army HexStacker (fleet accessible via ◀/▶ navigation)
    renderFleetMarkers(fleets, hexesWithOwnTroops);
    _all_fleets = fleets || [];

    // Render in-progress construction markers
    renderConstructionMarkers(constructions, currentPlayerId);

    loading.value = false;
  } catch (err) {
    console.error('Failed to fetch hexagon data:', err);
    error.value = err.message || 'Failed to load map data';
    loading.value = false;
  }
};

/**
 * Clear all army markers from the map
 */
const clearArmyMarkers = () => {
  if (armyMarkersLayer) {
    armyMarkersLayer.clearLayers();
  }
};

/**
 * Clear all worker markers from the map
 */
const clearWorkerMarkers = () => {
  if (workersMarkersLayer) {
    workersMarkersLayer.clearLayers();
  }
};

/**
 * Clear all construction markers from the map
 */
const clearConstructionMarkers = () => {
  if (constructionMarkersLayer) {
    constructionMarkersLayer.clearLayers();
  }
};

/**
 * Render in-progress bridge construction markers.
 * Shows a 🏗️ icon with the remaining turns counter.
 * Own constructions: orange-amber. Foreign: muted teal.
 * @param {Array} constructions - [{ h3_index, type, progress_turns, total_turns, remaining_turns, player_id, player_name }]
 * @param {number} currentPlayerId
 */
const renderConstructionMarkers = (constructions, currentPlayerId) => {
  clearConstructionMarkers();
  if (!constructions || constructions.length === 0) return;

  for (const c of constructions) {
    try {
      const [lat, lng] = cellToLatLng(c.h3_index);
      const isOwn = c.player_id === currentPlayerId;
      const bg = isOwn ? '#f97316' : '#4b5563';
      const border = isOwn ? '#c2410c' : '#374151';
      const pct = Math.round((c.progress_turns / c.total_turns) * 100);

      const icon = L.divIcon({
        className: '',
        html: `<div style="
            position:relative;
            width:36px;height:36px;
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            background:${bg};border:2px solid ${border};border-radius:6px;
            box-shadow:0 2px 6px rgba(0,0,0,0.5);cursor:default;"
            title="${c.player_name} · Puente ${pct}% · ${c.remaining_turns} turnos restantes">
          <span style="font-size:14px;line-height:1;">🏗️</span>
          <span style="font-size:9px;font-weight:700;color:#fff;line-height:1.1;margin-top:1px;">${c.remaining_turns}t</span>
        </div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        pane: 'constructionPane',
      });

      const progressBar = `<div style="background:#374151;border-radius:3px;height:6px;margin-top:6px;overflow:hidden;">
        <div style="background:${isOwn ? '#f97316' : '#6b7280'};width:${pct}%;height:100%;border-radius:3px;"></div>
      </div>`;

      const marker = L.marker([lat, lng], { icon, pane: 'constructionPane', interactive: true });
      marker.bindPopup(
        `<div style="font-family:sans-serif;font-size:13px;min-width:160px;">
          <strong>🏗️ Puente en construcción</strong><br>
          <span style="color:#6b7280;">👤 ${c.player_name}</span><br>
          <span style="color:#6b7280;font-size:11px;">📍 ${c.h3_index}</span><br>
          <div style="margin-top:6px;">
            <span style="color:#d1d5db;">Progreso: ${c.progress_turns} / ${c.total_turns} turnos</span>
            ${progressBar}
            <span style="color:#f97316;font-weight:600;">${c.remaining_turns} turnos restantes</span>
          </div>
        </div>`,
        { maxWidth: 220 }
      );

      constructionMarkersLayer.addLayer(marker);
    } catch { /* continue silently */ }
  }
};

/**
 * Render worker icons on the map.
 * Own workers: amber (#f59e0b). Foreign workers: teal (#0d9488).
 * Distinct from armies (blue/red circles) via different color and emoji.
 * @param {Array} workers - [{ h3_index, player_id, player_name, worker_type, worker_count }]
 * @param {number} currentPlayerId
 */
const renderWorkerMarkers = (workers, currentPlayerId) => {
  clearWorkerMarkers();
  if (!workers || workers.length === 0) return;

  // Group by hex: one icon per hex, sum counts across types if mixed
  // Keep first_worker_id from the lowest-id row so the popup can move a single worker
  const byHex = new Map();
  for (const w of workers) {
    const key = w.h3_index;
    if (!byHex.has(key)) {
      byHex.set(key, { ...w });
    } else {
      const existing = byHex.get(key);
      existing.worker_count += w.worker_count;
      if (w.first_worker_id < existing.first_worker_id) {
        existing.first_worker_id = w.first_worker_id;
      }
    }
  }

  for (const [h3_index, data] of byHex) {
    try {
      const [lat, lng] = cellToLatLng(h3_index);

      const isOwn = data.player_id === currentPlayerId;
      const color = isOwn ? '#f59e0b' : '#0d9488';
      const borderColor = isOwn ? '#b45309' : '#0f766e';

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:26px;height:26px;border-radius:50%;
          background:${color};border:2px solid ${borderColor};
          display:flex;align-items:center;justify-content:center;
          font-size:13px;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,0.45);
          cursor:pointer;"
          title="${data.worker_count} ${data.worker_type}(s) · ${data.player_name}">⛏️</div>`,
        iconSize: [26, 26],
        iconAnchor: [4, 21],
        pane: 'workerPane',
      });

      const BRIDGE_TERRAINS = ['Río', 'Agua'];
      const canBuildBridge  = isOwn && BRIDGE_TERRAINS.includes(data.terrain_type);
      const canBuildEdificio = isOwn && !BRIDGE_TERRAINS.includes(data.terrain_type);

      const terrainLabel = data.terrain_type
        ? `<span style="color:#6b7280;font-size:11px;">🌍 ${data.terrain_type}</span><br>`
        : '';

      const buildBtn = isOwn
        ? canBuildBridge
          ? `<button id="worker-build-btn-${h3_index}"
               style="flex:1;padding:4px 6px;border:none;border-radius:4px;
                      background:#22c55e;color:#14532d;font-size:12px;font-weight:600;cursor:pointer;"
               title="Construir puente (consume trabajadores)">🌉 Puente</button>`
          : `<button id="worker-build-btn-${h3_index}"
               style="flex:1;padding:4px 6px;border:none;border-radius:4px;
                      background:#22c55e;color:#14532d;font-size:12px;font-weight:600;cursor:pointer;"
               title="Construir edificio en este feudo">🏛️ Edificio</button>`
        : '';

      const ownActions = isOwn ? `
        <div style="display:flex;gap:6px;margin-top:8px;">
          ${buildBtn}
          <button
            id="worker-move-btn-${h3_index}"
            data-worker-id="${data.first_worker_id}"
            style="flex:1;padding:4px 6px;border:none;border-radius:4px;
                   background:#f59e0b;color:#1c1917;font-size:12px;font-weight:600;cursor:pointer;"
            >➡️ Mover</button>
        </div>` : '';

      const marker = L.marker([lat, lng], { icon, pane: 'workerPane' });
      marker.bindPopup(
        `<div style="font-family:sans-serif;font-size:13px;min-width:160px;">
          <strong>⛏️ Trabajadores</strong><br>
          <span style="color:#d1d5db;">${data.worker_count} ${data.worker_type}(s)</span><br>
          <span style="color:#6b7280;">👤 ${data.player_name}</span><br>
          <span style="color:#6b7280;font-size:11px;">📍 ${h3_index}</span><br>
          ${terrainLabel}
          ${ownActions}
        </div>`,
        { maxWidth: 220 }
      );

      // Wire up popup buttons after it opens
      if (isOwn) {
        marker.on('popupopen', () => {
          setTimeout(() => {
            const moveBtn = document.getElementById(`worker-move-btn-${h3_index}`);
            if (moveBtn) {
              moveBtn.addEventListener('click', () => {
                const workerId = parseInt(moveBtn.dataset.workerId, 10);
                marker.closePopup();
                window.startWorkerMovement(h3_index, workerId);
              });
            }
            const buildBtnEl = document.getElementById(`worker-build-btn-${h3_index}`);
            if (buildBtnEl) {
              buildBtnEl.addEventListener('click', () => {
                marker.closePopup();
                if (canBuildBridge) {
                  buildBridgeFromPopup(h3_index);
                } else {
                  buildModalOpenedFromWorker.value = true;
                  openBuildModal(h3_index);
                }
              });
            }
          }, 50);
        });
      }

      workersMarkersLayer.addLayer(marker);
    } catch { /* continue silently */ }
  }
};

const clearFleetMarkers = () => { if (fleetMarkersLayer) fleetMarkersLayer.clearLayers(); };

/**
 * Render own naval fleet markers on the map.
 * Each fleet gets a clickable ⛵ marker with a popup:
 * Moverse / Detenerse / Embarcar Tropas / Desembarcar Tropas
 */
const renderFleetMarkers = (fleets, hexesWithOwnTroops = new Set()) => {
  clearFleetMarkers();
  if (!fleets || fleets.length === 0) return;

  for (const fleet of fleets) {
    try {
      // Fleet hidden when own troops are already visible at this hex (accessible via ◀/▶ popup)
      if (hexesWithOwnTroops.has(fleet.h3_index)) continue;

      const [lat, lng] = cellToLatLng(fleet.h3_index);

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:26px;height:26px;border-radius:50%;
          background:#1a4a8a;border:2px solid #4a9eff;
          display:flex;align-items:center;justify-content:center;
          font-size:14px;line-height:1;
          box-shadow:0 1px 5px rgba(0,0,0,0.55);
          cursor:pointer;"
          title="${fleet.name} · ${fleet.total_ships} barcos">⛵</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        pane: 'fleetPane',
      });

      const marker = L.marker([lat, lng], { icon, pane: 'fleetPane' });

      marker.on('click', () => {
        MapInteractionController.handleMapClick(fleet.h3_index, {
          onNormal: async () => showArmyDetailsPopup(fleet.h3_index, [lat, lng]),
          onSelectDestination: dispatchMovement,
          onSelectWorkerDestination: async (workerId, fromH3, targetH3) => {
            await processWorkerMovement(workerId, fromH3, targetH3);
          },
        });
      });

      fleetMarkersLayer.addLayer(marker);
    } catch { /* continue silently */ }
  }
};

/**
 * Clear all fief building icons from the map
 */
const clearFiefIcons = () => {
  if (fiefIconsLayer) {
    fiefIconsLayer.clearLayers();
  }
};

/**
 * Clear all HexStacker combined markers from the map
 */
const clearHexStackers = () => {
  if (hexStackerLayer) hexStackerLayer.clearLayers();
  _hexStackerMarkers.clear();
};

/**
 * Fetch completed buildings in the visible map bounds and render icons
 */
const fetchBuildingData = async () => {
  try {
    if (!map) return;
    const bounds = map.getBounds();
    const params = {
      minLat: bounds.getSouth(),
      maxLat: bounds.getNorth(),
      minLng: bounds.getWest(),
      maxLng: bounds.getEast()
    };
    const data = await mapApi.getMapBuildings(params);
    if (data.success) {
      renderFiefIcons(data.buildings);
    }
  } catch (err) {
    // Silent — building icons are supplementary
  }
};

/**
 * Render fief building icons on the map (from /api/map/buildings).
 * Each completed building gets a small icon centered on its hex.
 * @param {Array} buildings - [{ h3_index, building_name, type_name }]
 */
const renderFiefIcons = (buildings) => {
  clearFiefIcons();
  if (!buildings || buildings.length === 0) return;

  for (const bld of buildings) {
    try {
      const [lat, lng] = cellToLatLng(bld.h3_index);
      const isWip = bld.is_under_construction;
      const icon = isWip ? '🏗️' : getBuildingIcon(bld.building_name, bld.type_name);
      const border = isWip ? '#c5a059' : '#9e9e9e';
      const bg = isWip ? 'rgba(30,20,10,0.82)' : 'rgba(20,30,20,0.82)';

      const iconHtml = `<div style="
        background: ${bg};
        border: 1.5px solid ${border};
        border-radius: 5px;
        width: 22px; height: 22px;
        display: flex; align-items: center; justify-content: center;
        font-size: 13px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.6);
        cursor: default;
        user-select: none;">${icon}</div>`;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'building-marker-icon',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      const marker = L.marker([lat, lng], { icon: customIcon, pane: 'buildingPane', interactive: false });
      marker.addTo(fiefIconsLayer);
    } catch (err) {
      // Skip bad hex
    }
  }
};

/**
 * Renders combined HexStacker markers per hex.
 * Each hex gets one divIcon combining building (top) + own entities (bottom-left)
 * + enemy entities (bottom-right). Entities include troops, characters, workers.
 * When a slot has > 1 entity, ◀/▶ nav arrows appear.
 *
 * @param {Array}  buildings       - building entries from API
 * @param {Array}  armyEntries     - army entries from API
 * @param {Array}  workers         - worker entries from API
 * @param {Array}  ownChars        - own character objects (_char_cache)
 * @param {Array}  enemyChars      - visible enemy character objects
 * @param {number} currentPlayerId
 * @param {Map}    ownerMap        - h3_index → { color, player_id }
 */
const renderHexStackers = (buildings, armyEntries, workers, ownChars, enemyChars, currentPlayerId, ownerMap) => {
  clearHexStackers();
  clearArmyMarkers();
  clearFiefIcons();

  // ── Per-hex indices ───────────────────────────────────────────────────────
  const buildingByHex = new Map();
  for (const b of (buildings || [])) buildingByHex.set(b.h3_index, b);

  const armyByHex = new Map();
  for (const a of (armyEntries || [])) {
    if (!armyByHex.has(a.h3_index)) armyByHex.set(a.h3_index, []);
    armyByHex.get(a.h3_index).push(a);
  }

  // Workers grouped by hex (sum counts, keep lowest first_worker_id)
  const workerByHex = new Map();
  for (const w of (workers || [])) {
    if (!workerByHex.has(w.h3_index)) {
      workerByHex.set(w.h3_index, { ...w });
    } else {
      const ex = workerByHex.get(w.h3_index);
      ex.worker_count += w.worker_count;
      if (w.first_worker_id < ex.first_worker_id) ex.first_worker_id = w.first_worker_id;
    }
  }

  // Own chars by hex (skip chars travelling with armies / fleets / underage)
  const ownCharsByHex = new Map();
  for (const c of (ownChars || [])) {
    if (!c.h3_index || c.age < 16 || c.army_id || c.transported_by) continue;
    if (!ownCharsByHex.has(c.h3_index)) ownCharsByHex.set(c.h3_index, []);
    ownCharsByHex.get(c.h3_index).push(c);
  }

  // Enemy chars by hex
  const enemyCharsByHex = new Map();
  for (const c of (enemyChars || [])) {
    if (!c.h3_index) continue;
    if (!enemyCharsByHex.has(c.h3_index)) enemyCharsByHex.set(c.h3_index, []);
    enemyCharsByHex.get(c.h3_index).push(c);
  }

  const candidateHexes = new Set([
    ...buildingByHex.keys(),
    ...armyByHex.keys(),
    ...workerByHex.keys(),
    ...ownCharsByHex.keys(),
    ...enemyCharsByHex.keys(),
  ]);

  for (const h3_index of candidateHexes) {
    try {
      const [lat, lng] = cellToLatLng(h3_index);
      const bld = buildingByHex.get(h3_index) || null;

      // ── Own entities ──────────────────────────────────────────────────────
      const ownEntities = [];
      let ownTroops = 0;
      let ownHasFieldArmy = false;
      let hasEmbarckedTroops = false;
      const armyGroup = armyByHex.get(h3_index);
      if (armyGroup) {
        for (const e of armyGroup) {
          if (e.player_id === currentPlayerId) {
            ownTroops += Number(e.total_troops) || 0;
            if (!e.has_garrison || Number(e.army_count) > 1) ownHasFieldArmy = true;
            if (e.has_embarked_armies) hasEmbarckedTroops = true;
          } else if (e.has_embarked_armies) {
            hasEmbarckedTroops = true;
          }
        }
      }
      if (ownTroops > 0) {
        ownEntities.push({ type: 'troops', count: ownTroops, isGarrisonOnly: !ownHasFieldArmy });
      }
      for (const c of (ownCharsByHex.get(h3_index) || [])) {
        ownEntities.push({ type: 'char', ...c });
      }
      const workerData = workerByHex.get(h3_index);
      if (workerData && workerData.player_id === currentPlayerId) {
        ownEntities.push({ type: 'worker', ...workerData });
      }

      // ── Enemy entities ────────────────────────────────────────────────────
      const enemyEntities = [];
      let enemyTroops = 0;
      let enemyNaval = 0;
      if (armyGroup) {
        for (const e of armyGroup) {
          if (e.player_id !== currentPlayerId) {
            if (e.has_naval && !e.has_garrison && Number(e.total_troops) === 0) {
              enemyNaval += 1;
            } else {
              enemyTroops += 1;
            }
          }
        }
      }
      if (enemyTroops > 0) {
        enemyEntities.push({ type: 'troops', count: enemyTroops, isGarrisonOnly: false });
      }
      if (enemyNaval > 0) {
        enemyEntities.push({ type: 'fleet', count: enemyNaval });
      }
      for (const c of (enemyCharsByHex.get(h3_index) || [])) {
        enemyEntities.push({ type: 'char', ...c });
      }
      if (workerData && workerData.player_id !== currentPlayerId) {
        enemyEntities.push({ type: 'worker', ...workerData });
      }

      const isConflict = ownTroops > 0 && enemyTroops > 0;

      if (!bld && ownEntities.length === 0 && enemyEntities.length === 0 && !hasEmbarckedTroops) continue;

      const divIcon = createStackerDivIcon(L, {
        building: bld,
        ownEntities,
        enemyEntities,
        h3Index: h3_index,
        isConflict,
        hasFleet: hasEmbarckedTroops,
      });

      const marker = L.marker([lat, lng], {
        icon:        divIcon,
        pane:        'stackerPane',
        interactive: true,
      });

      marker.on('click', (ev) => {
        const tgt = ev.originalEvent?.target;

        // ── Nav arrow click ────────────────────────────────────────────────
        const navBtn = tgt?.closest?.('.hs-nav-btn');
        if (navBtn) {
          ev.originalEvent.stopPropagation();
          const side  = navBtn.dataset.side;
          const dir   = parseInt(navBtn.dataset.dir, 10);
          const count = parseInt(navBtn.dataset.count, 10);
          advanceNavIdx(h3_index, side, dir, count);
          const newIcon = createStackerDivIcon(L, {
            building: bld, ownEntities, enemyEntities,
            h3Index: h3_index, isConflict, hasFleet: hasEmbarckedTroops,
          });
          marker.setIcon(newIcon);
          return;
        }

        // ── Character badge click ──────────────────────────────────────────
        const charEl = tgt?.closest?.('.hs-char');
        if (charEl) {
          const charId  = parseInt(charEl.dataset.charId, 10);
          const isEnemy = charEl.dataset.isEnemy === '1';
          openCharPopup(charId, isEnemy, [lat, lng]);
          return;
        }

        // ── Worker badge click ─────────────────────────────────────────────
        const workerEl = tgt?.closest?.('.hs-worker');
        if (workerEl) {
          openWorkerPopup(workerEl.dataset.workerH3, [lat, lng]);
          return;
        }

        // ── Troops badge click ─────────────────────────────────────────────
        const troopsEl = tgt?.closest?.('.hs-troops');
        if (troopsEl && (ownTroops > 0 || enemyTroops > 0)) {
          MapInteractionController.handleMapClick(h3_index, {
            onNormal: async () => showArmyDetailsPopup(h3_index, [lat, lng]),
            onSelectDestination: dispatchMovement,
            onSelectWorkerDestination: async (workerId, fromH3, targetH3) => {
              await processWorkerMovement(workerId, fromH3, targetH3);
            },
          });
          return;
        }

        // ── Fief / building click (default) ───────────────────────────────
        MapInteractionController.handleMapClick(h3_index, {
          onNormal: async () => showCellDetailsPopup(h3_index, [lat, lng]),
          onSelectDestination: dispatchMovement,
          onSelectWorkerDestination: async (workerId, fromH3, targetH3) => {
            await processWorkerMovement(workerId, fromH3, targetH3);
          },
        });
      });

      marker.addTo(hexStackerLayer);
      _hexStackerMarkers.set(h3_index, marker);
    } catch (err) {
      // Skip bad hex silently
    }
  }
};

/**
 * Obtiene las rutas activas propias del servidor y las dibuja en el mapa.
 * Se llama desde fetchArmyData para mantener las rutas sincronizadas.
 */
const fetchAndDrawRoutes = async () => {
  try {
    const [routeData] = await Promise.all([mapApi.getMyRoutes()]);
    if (!routeData.success) return;

    RouteVisualizer.clear();

    // Rutas de ejércitos
    for (const route of routeData.routes) {
      if (route.path && route.path.length > 0) {
        RouteVisualizer.drawPath(route.army_id, route.path, route.h3_index);
      }
    }

    // Rutas de constructores (azul) — redibujar tras el clear
    for (const w of myWorkers.value) {
      if (w.destination_h3) {
        RouteVisualizer.drawWorkerPath(w.id, w.h3_index, w.destination_h3);
      }
    }
  } catch (err) {
    // Las rutas son suplementarias — silenciar errores de red
    console.warn('[MapViewer] fetchAndDrawRoutes:', err.message);
  }
};

/**
 * Fetch army data from backend based on visible map bounds
 * Only fetches if zoom level is valid (11-17)
 */
const fetchArmyData = async () => {
  try {
    // Routes always visible regardless of zoom
    await fetchAndDrawRoutes();

    const currentZoom = map.getZoom();

    if (currentZoom < MIN_ZOOM_H3 || currentZoom > MAX_ZOOM_H3) {
      clearHexStackers();
      clearArmyMarkers();
      return;
    }

    const bounds = map.getBounds();
    const params = {
      minLat: bounds.getSouth(),
      maxLat: bounds.getNorth(),
      minLng: bounds.getWest(),
      maxLng: bounds.getEast(),
    };

    // Fetch armies, buildings and own fleets together so HexStacker stays accurate
    const [armyRes, buildRes, fleetRes] = await Promise.allSettled([
      mapApi.getMapArmies(params),
      mapApi.getMapBuildings(params),
      mapApi.getFleets(),
    ]);

    const armies    = armyRes.status  === 'fulfilled' && armyRes.value.success
      ? armyRes.value.armies  : [];
    const buildings = buildRes.status === 'fulfilled' && buildRes.value.success
      ? buildRes.value.buildings : [];
    const cPlayerId = armyRes.status === 'fulfilled'
      ? armyRes.value.current_player_id : playerId.value;
    const fleets    = fleetRes.status === 'fulfilled' && fleetRes.value.success
      ? fleetRes.value.fleets : [];

    _cachedBuildings       = buildings;
    _cachedArmies          = armies;
    _cachedCurrentPlayerId = cPlayerId;
    renderHexStackers(buildings, armies, _cachedWorkers, _char_cache, _enemy_char_cache, cPlayerId, null);
    renderFleetMarkers(fleets);
  } catch (err) {
    console.error('Failed to fetch army data:', err);
  }
};

/**
 * Render army markers on the map.
 * Groups entries by h3_index so each hex gets exactly one marker.
 * Icon logic:
 *   - 1 army in hex  → 🗡️ (single sword)
 *   - 2+ armies      → ⚔️ (crossed swords)
 *   - Mixed players  → ⚔️ with red conflict glow
 * @param {Array} armies - Array of {h3_index, player_id, army_count, total_troops}
 * @param {Number} currentPlayerId - The current player's ID
 */
const renderArmyMarkers = (armies, currentPlayerId) => {
  clearArmyMarkers();

  if (!armies || armies.length === 0) return;

  // Group rows by h3_index (backend returns one row per (h3_index, player_id))
  const hexGroups = new Map();
  for (const entry of armies) {
    if (!hexGroups.has(entry.h3_index)) hexGroups.set(entry.h3_index, []);
    hexGroups.get(entry.h3_index).push(entry);
  }

  for (const [h3_index, group] of hexGroups) {
    try {
      const [lat, lng] = cellToLatLng(h3_index);

      // Total army count across all players in this hex
      const totalArmies = group.reduce((sum, e) => sum + (Number(e.army_count) || 1), 0);
      const playerIds = new Set(group.map(e => e.player_id));
      const hasOwn    = playerIds.has(currentPlayerId);
      const isMultiple = totalArmies > 1;
      // Conflict: armies from different players share the hex
      const isConflict = playerIds.size > 1;

      // Icon glyph: ship for pure naval groups, swords for land armies
      const allNaval = group.every(e => e.has_naval && !e.has_garrison && Number(e.total_troops) === 0);
      const glyph = allNaval ? '⛵' : (isMultiple ? '⚔️' : '🗡️');

      // Colors
      // Color rule: any enemy present → red. Own troops only → blue.
      const hasEnemy = [...playerIds].some(id => id !== currentPlayerId);
      let bg, border, shadow;
      if (hasEnemy) {
        // Conflict glow when own troops are also present; plain red otherwise
        bg     = '#b71c1c';
        border = '#ef5350';
        shadow = isConflict
          ? '0 0 8px 2px rgba(255,23,68,0.8)'
          : '0 2px 5px rgba(0,0,0,0.5)';
      } else {
        bg     = '#1565C0';
        border = '#42a5f5';
        shadow = '0 2px 5px rgba(0,0,0,0.5)';
      }

      const iconHtml = `<div style="
        background:${bg};border:2px solid ${border};border-radius:50%;
        width:26px;height:26px;
        display:flex;align-items:center;justify-content:center;
        font-size:13px;box-shadow:${shadow};cursor:pointer;
        user-select:none;">${glyph}</div>`;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'army-marker-icon',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const marker = L.marker([lat, lng], { icon: customIcon, pane: 'armyPane' });
      marker.on('click', () => {
        MapInteractionController.handleMapClick(h3_index, {
          onNormal: async () => showArmyDetailsPopup(h3_index, [lat, lng]),
          onSelectDestination: dispatchMovement,
          onSelectWorkerDestination: async (workerId, fromH3, targetH3) => {
            await processWorkerMovement(workerId, fromH3, targetH3);
          },
        });
      });
      marker.addTo(armyMarkersLayer);
    } catch (err) {
      console.error(`Error rendering army marker for ${h3_index}:`, err);
    }
  }
};

/**
 * Opens a Leaflet popup with character details at the given latlng.
 * Handles both own characters (with action buttons) and enemy characters.
 *
 * @param {number}  charId  - character id
 * @param {boolean} isEnemy - true if enemy character
 * @param {Array}   latlng  - [lat, lng]
 */
const openCharPopup = (charId, isEnemy, latlng) => {
  const char = isEnemy
    ? _enemy_char_cache.find(c => c.id === charId)
    : _char_cache.find(c => c.id === charId);
  if (!char) return;

  let popupHtml;
  if (isEnemy) {
    const icon = char.is_main_character ? '👑' : '🧑';
    popupHtml = `
      <div class="char-popup">
        <div class="char-popup-header">
          <span class="char-popup-icon">${icon}</span>
          <div>
            <div class="char-popup-name">${char.name}</div>
            <div class="char-popup-meta" style="color:#9ca3af">${char.player_name}</div>
          </div>
        </div>
        <div class="char-popup-actions">
          <button id="char-capture-${char.id}" class="army-action-icon army-action-disabled" title="Necesitas un ejército en este feudo para capturar">⛓️</button>
        </div>
      </div>`;
  } else {
    const isMain      = char.is_main_character;
    const label       = char.full_title || char.name;
    const isMoving    = !!char.destination;
    const stopTitle   = isMoving ? 'Detener movimiento' : 'Retirar del mapa';
    const movingBadge = isMoving ? `<span class="char-popup-moving">&#8594; en marcha</span>` : '';
    const popupIcon   = isMain ? '👑' : char.is_heir ? '🤴' : char.age < 16 ? '🧒' : '⭐';
    const joinLeaveBtn = char.army_id
      ? `<button id="char-leave-${char.id}" class="army-action-icon" title="Abandonar ejército">🚪</button>`
      : `<button id="char-join-${char.id}" class="army-action-icon" title="Unirse al ejército del feudo">🔗</button>`;
    popupHtml = `
      <div class="char-popup">
        <div class="char-popup-header">
          <span class="char-popup-icon">${popupIcon}</span>
          <div>
            <div class="char-popup-name">${label} ${movingBadge}</div>
            <div class="char-popup-meta">Nv.${Math.floor((char.level ?? 1) / 10)} · +${char.combat_buff_pct}% combate · Guardia ${char.personal_guard}/25</div>
          </div>
        </div>
        <div class="char-popup-actions">
          <button id="char-move-${char.id}" class="army-action-icon" title="Establecer destino">📍</button>
          <button id="char-stop-${char.id}" class="army-action-icon" title="${stopTitle}">🛑</button>
          ${joinLeaveBtn}
        </div>
      </div>`;
  }

  L.popup({ className: 'char-leaflet-popup', maxWidth: 220 })
    .setLatLng(latlng)
    .setContent(popupHtml)
    .openOn(map);

  setTimeout(() => {
    if (isEnemy) {
      const btn = document.getElementById(`char-capture-${char.id}`);
      if (!btn) return;
      const hasArmyHere = armies.value.some(a => a.h3_index === char.h3_index && !a.destination);
      if (hasArmyHere) {
        btn.classList.remove('army-action-disabled');
        btn.title = 'Capturar';
        btn.addEventListener('click', () => handleEnemyCharacterCapture(char));
      }
    } else {
      const moveBtn  = document.getElementById(`char-move-${char.id}`);
      const stopBtn  = document.getElementById(`char-stop-${char.id}`);
      const joinBtn  = document.getElementById(`char-join-${char.id}`);
      const leaveBtn = document.getElementById(`char-leave-${char.id}`);
      if (moveBtn)  moveBtn.addEventListener('click',  () => handleCharacterMove(char));
      if (stopBtn)  stopBtn.addEventListener('click',  () => handleCharacterStop(char));
      if (joinBtn)  joinBtn.addEventListener('click',  () => handleCharacterJoin(char));
      if (leaveBtn) leaveBtn.addEventListener('click', () => handleCharacterLeave(char));
    }
  }, 50);
};

/**
 * Opens a Leaflet popup with worker details at the given latlng.
 *
 * @param {string} h3Index - hex index of the worker group
 * @param {Array}  latlng  - [lat, lng]
 */
const openWorkerPopup = (h3Index, latlng) => {
  // Workers are cached in _cachedWorkers; rebuild by-hex map on demand
  const workerData = _cachedWorkers.reduce((acc, w) => {
    if (w.h3_index !== h3Index) return acc;
    if (!acc) return { ...w };
    acc.worker_count += w.worker_count;
    if (w.first_worker_id < acc.first_worker_id) acc.first_worker_id = w.first_worker_id;
    return acc;
  }, null);
  if (!workerData) return;

  const isOwn = workerData.player_id === _cachedCurrentPlayerId;
  const BRIDGE_TERRAINS = ['Río', 'Agua'];
  const canBuildBridge   = isOwn && BRIDGE_TERRAINS.includes(workerData.terrain_type);
  const canBuildEdificio = isOwn && !BRIDGE_TERRAINS.includes(workerData.terrain_type);

  const terrainLabel = workerData.terrain_type
    ? `<span style="color:#6b7280;font-size:11px;">🌍 ${workerData.terrain_type}</span><br>`
    : '';

  const buildBtn = isOwn
    ? canBuildBridge
      ? `<button id="worker-build-btn-${h3Index}" style="flex:1;padding:4px 6px;border:none;border-radius:4px;background:#22c55e;color:#14532d;font-size:12px;font-weight:600;cursor:pointer;" title="Construir puente (consume trabajadores)">🌉 Puente</button>`
      : `<button id="worker-build-btn-${h3Index}" style="flex:1;padding:4px 6px;border:none;border-radius:4px;background:#22c55e;color:#14532d;font-size:12px;font-weight:600;cursor:pointer;" title="Construir edificio en este feudo">🏛️ Edificio</button>`
    : '';

  const ownActions = isOwn ? `
    <div style="display:flex;gap:6px;margin-top:8px;">
      ${buildBtn}
      <button id="worker-move-btn-${h3Index}" data-worker-id="${workerData.first_worker_id}"
        style="flex:1;padding:4px 6px;border:none;border-radius:4px;background:#f59e0b;color:#1c1917;font-size:12px;font-weight:600;cursor:pointer;">➡️ Mover</button>
    </div>` : '';

  const popupHtml = `
    <div style="font-family:sans-serif;font-size:13px;min-width:160px;">
      <strong>⛏️ Trabajadores</strong><br>
      <span style="color:#d1d5db;">${workerData.worker_count} ${workerData.worker_type}(s)</span><br>
      <span style="color:#6b7280;">👤 ${workerData.player_name}</span><br>
      <span style="color:#6b7280;font-size:11px;">📍 ${h3Index}</span><br>
      ${terrainLabel}
      ${ownActions}
    </div>`;

  L.popup({ maxWidth: 220 })
    .setLatLng(latlng)
    .setContent(popupHtml)
    .openOn(map);

  if (isOwn) {
    setTimeout(() => {
      const moveBtn = document.getElementById(`worker-move-btn-${h3Index}`);
      if (moveBtn) {
        moveBtn.addEventListener('click', () => {
          const workerId = parseInt(moveBtn.dataset.workerId, 10);
          map.closePopup();
          window.startWorkerMovement(h3Index, workerId);
        });
      }
      const buildBtnEl = document.getElementById(`worker-build-btn-${h3Index}`);
      if (buildBtnEl) {
        buildBtnEl.addEventListener('click', () => {
          map.closePopup();
          if (canBuildBridge) {
            buildBridgeFromPopup(h3Index);
          } else {
            buildModalOpenedFromWorker.value = true;
            openBuildModal(h3Index);
          }
        });
      }
    }, 50);
  }
};

/**
 * Fetch characters and update stacker caches. Routes are drawn here.
 * Characters are now rendered as stacker entities, not separate markers.
 */
const fetchAndRenderCharacters = async () => {
  try {
    // ── Own characters ────────────────────────────────────────────────────────
    const data = await mapApi.getMyCharacters();
    _char_cache = data.characters ?? [];

    // Draw routes for moving characters
    for (const char of _char_cache) {
      if (char.destination && char.h3_index) {
        try {
          const path = gridPathCells(char.h3_index, char.destination).slice(1);
          RouteVisualizer.drawPath(`char_${char.id}`, path, char.h3_index);
        } catch (_) { /* ignore unreachable destinations */ }
      }
    }

    // ── Visible enemy characters ──────────────────────────────────────────────
    const enemyData = await mapApi.getVisibleEnemyCharacters();
    _enemy_char_cache = enemyData.characters ?? [];

    // ── Re-render stackers with updated character data ────────────────────────
    if (_cachedCurrentPlayerId !== null) {
      renderHexStackers(
        _cachedBuildings, _cachedArmies, _cachedWorkers,
        _char_cache, _enemy_char_cache,
        _cachedCurrentPlayerId, _cachedOwnerMap,
      );
    }
  } catch (e) {
    console.error('Error fetching characters for map:', e);
  }
};

/**
 * Fetch player data (gold, color, etc)
 */
const fetchPlayerData = async () => {
  try {
    const data = await mapApi.getPlayer(playerId.value);
    if (data) {
      playerGold.value = data.gold;
      console.log(`✓ Player data loaded: ${data.username} has ${playerGold.value} gold`);
    }
  } catch (err) {
    console.error('Failed to fetch player data:', err);
  }
};

/**
 * Fetch terrain types for the legend
 */
const fetchTerrainTypes = async () => {
  try {
    const data = await mapApi.getTerrainTypes();
    // Sort alphabetically by name
    terrainTypes.value = data.filter(t => t.sort_order != null).sort((a, b) => a.sort_order - b.sort_order);
    console.log(`✓ Loaded ${terrainTypes.value.length} terrain types (sorted by sort_order)`);
  } catch (err) {
    console.error('Failed to fetch terrain types:', err);
  }
};

/**
 * Fetch world state (turn and date)
 */
const fetchWorldState = async () => {
  try {
    const data = await mapApi.getWorldState();
    if (data.success) {
      currentTurn.value = data.turn;
      gameDate.value = data.date;
      formattedDate.value = formatDate(gameDate.value);
      dayOfYear.value = currentTurn.value % 365;
      console.log(`✓ World state loaded: Turn ${currentTurn.value}, Day ${dayOfYear.value}/365, Date ${formattedDate.value}`);
    }
  } catch (err) {
    console.error('Failed to fetch world state:', err);
  }
};

/**
 * Load exploration configuration from server
 */
const loadExplorationConfig = async () => {
  try {
    const data = await mapApi.getGameConfig();
    if (data.success && data.config.exploration) {
      explorationConfig.value = {
        turns_required: Number(data.config.exploration.turns_required || 5),
        gold_cost: Number(data.config.exploration.gold_cost || 100)
      };
      console.log(`✓ Exploration config loaded:`, explorationConfig.value);
    }
  } catch (err) {
    // Handle authentication/authorization errors
    if (err.response?.status === 401) {
      console.error('❌ No autenticado - Se requiere login para acceder a configuración de admin');
      showToast('Sesión expirada o inválida', 'error');
    } else if (err.response?.status === 403) {
      console.warn('No admin — config de exploración no disponible');
    } else {
      console.warn('Failed to load exploration config, using defaults:', err.message);
    }
    // Keep default values on any error
  }
};

/**
 * Format date to Spanish format: "1 de Enero, 210 a.C."
 * All dates are in the BC era (game starts in 210 BC).
 */
const formatDate = (date) => {
  const months = [
    'Ianuarius', 'Februarius', 'Martius', 'Aprilis', 'Maius', 'Iunius',
    'Quintilis', 'Sextilis', 'September', 'October', 'November', 'December'
  ];
  const month = months[date.month - 1];
  const suffix = date.era === 'BC' ? 'a.C.' : 'd.C.';
  const auc = date.era === 'BC' ? 753 - date.year : 753 + date.year;
  const toRoman = (n) => {
    const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
    const syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
    let r = '';
    for (let i = 0; i < vals.length; i++) {
      while (n >= vals[i]) { r += syms[i]; n -= vals[i]; }
    }
    return r;
  };
  return `${date.day} de ${month}, anno ${toRoman(auc)} AUC (${date.year} ${suffix})`;
};

/**
 * Advance to next turn
 * Processes turn advancement and updates UI
 */
/**
 * Sync game state with server
 * Polls the server to check for turn updates and refreshes UI accordingly
 */
const syncWithServer = async () => {
  try {
    console.log('[Sync] Checking server for game state updates...');
    const response = await mapApi.getWorldState();

    if (response.success) {
      const serverTurn = response.turn;
      const serverDate = response.date;

      // Check if turn has changed
      if (serverTurn !== currentTurn.value) {
        console.log(`[Sync] 🔄 Turn changed! ${currentTurn.value} → ${serverTurn}`);

        // Update world state
        const oldTurn = currentTurn.value;
        currentTurn.value = serverTurn;
        gameDate.value = serverDate;
        formattedDate.value = formatDate(serverDate);
        dayOfYear.value = serverTurn % 365;

        console.log(`[Sync] ✓ Updated to Turn ${serverTurn}, Day ${dayOfYear.value}/365`);

        // Notify turn change
        showToast(`⏳ Comienza un nuevo día\n${formattedDate.value}`, 'info');

        // Check if it's a harvest day
        if (dayOfYear.value === 75 || dayOfYear.value === 180) {
          const harvestSeason = dayOfYear.value === 75 ? 'PRIMAVERA' : 'VERANO';
          showToast(`🌾 ¡Cosecha de ${harvestSeason} completada por el servidor!`, 'success');
          showHarvestBanner(harvestSeason);
        }

        // Reload map data to reflect changes
        if (currentZoom.value >= MIN_ZOOM) {
          await loadHexagonsIfZoomValid();
        }

        // Update fiefs list
        await updateFiefsUI();

        // Reload messages (new harvest messages may have been generated)
        await loadMessages();

        // Refresh character markers (positions updated by turn engine)
        fetchAndRenderCharacters();

        // Refresh worker routes (workers advance each turn)
        fetchMyWorkers();

        lastSyncTime = Date.now();
      } else {
        console.log(`[Sync] ✓ No changes (Turn ${currentTurn.value})`);
      }
    }
  } catch (err) {
    console.error('[Sync] Error syncing with server:', err);
  }
};

/**
 * Start server synchronization polling
 */
const startSync = () => {
  console.log(`[Sync] Starting server sync (polling every ${SYNC_INTERVAL / 1000}s)`);

  // Clear any existing interval
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }

  // Immediate first sync
  syncWithServer();

  // Poll server at regular intervals
  syncIntervalId = setInterval(syncWithServer, SYNC_INTERVAL);
};

/**
 * Stop server synchronization
 */
const stopSync = () => {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    console.log('[Sync] Stopped server synchronization');
  }
};

/**
 * Update fiefs list from server (paginated)
 * @param {Object} opts - Override page/limit for the request
 */
const updateFiefsUI = async ({ page, limit } = {}) => {
  try {
    loadingFiefs.value = true;

    const requestPage  = page  ?? fiefsPage.value;
    const requestLimit = limit ?? fiefsLimit.value;

    const data = await mapApi.getMyFiefs({
      page:             requestPage,
      limit:            requestLimit,
      filter_name:      kingdomFilters.value.name     || '',
      filter_maxpop:    kingdomFilters.value.maxPopulation ?? null,
      filter_division:  kingdomFilters.value.division || '',
    });

    if (data.success) {
      fiefsTotalCount.value = data.total ?? 0;
      fiefsPage.value       = data.page  ?? requestPage;
      fiefsLimit.value      = data.limit ?? requestLimit;
      myFiefs.value         = data.fiefs || [];
    } else {
      myFiefs.value = [];
    }
  } catch (err) {
    console.error('[Fiefs] ❌ Error fetching fiefs:', err);
    myFiefs.value = [];
  } finally {
    loadingFiefs.value = false;
  }
};

const handleFiefsPageChange = (p) => {
  fiefsPage.value = p;
  updateFiefsUI({ page: p });
};

const handleFiefsLimitChange = (l) => {
  fiefsPage.value  = 1;
  fiefsLimit.value = l;
  updateFiefsUI({ page: 1, limit: l });
};

const loadMyDivisions = async () => {
  try {
    const data = await mapApi.getPlayerDivisions();
    myDivisions.value = data.divisions ?? [];
  } catch (_) {
    myDivisions.value = [];
  }
};

/**
 * Focus map on a specific fief
 * @param {string} h3_index - The H3 index to focus on
 */
const focusOnCharacterHex = (h3_index) => {
  try {
    const [lat, lng] = cellToLatLng(h3_index);
    closeOverlay();
    map.flyTo([lat, lng], 11, { duration: 1.0 });
  } catch (err) {
    console.error('[Characters] Error focusing on character:', err);
  }
};

const focusOnFief = (h3_index) => {
  try {
    const [lat, lng] = cellToLatLng(h3_index);
    map.flyTo([lat, lng], 11, {
      duration: 1.0
    });
    console.log(`[Fiefs] Focused on ${h3_index}`);
  } catch (err) {
    console.error('[Fiefs] Error focusing on fief:', err);
    showToast('Error al enfocar el feudo', 'error');
  }
};

/**
 * Load messages from server
 * Fetches all messages for the current player
 */
const loadMessages = async () => {
  try {
    loadingMessages.value = true;
    console.log(`[Messages] Loading messages for player ${playerId.value}...`);

    const data = await mapApi.getMessages({
      unread_only: false  // Load all messages, not just unread
    });

    console.log('[Messages] Response:', data);

    if (data.success) {
      myMessages.value = data.messages || [];
      console.log(`[Messages] ✓ Loaded ${myMessages.value.length} messages (${unreadCount.value} unread)`);
    } else {
      console.error('[Messages] Server returned success=false:', data);
      myMessages.value = [];
    }
  } catch (err) {
    console.error('[Messages] ❌ Error loading messages:', err);
    console.error('[Messages] Error details:', err.response?.data || err.message);
    myMessages.value = [];
  } finally {
    loadingMessages.value = false;
  }
};

/**
 * Mark message as read and show full content
 * @param {Object} message - The message to mark as read
 */
const readMessage = async (message) => {
  try {
    console.log('[Messages] Opening message:', message.id);
    console.log('[Messages] Message data:', {
      id: message.id,
      subject: message.subject,
      bodyLength: message.body?.length || 0,
      hasBody: !!message.body
    });

    // Show message detail immediately
    selectedMessage.value = message;

    // Mark as read on server if not already read
    if (!message.is_read) {
      console.log(`[Messages] Marking message ${message.id} as read...`);
      const data = await mapApi.markMessageAsRead(message.id);

      if (data.success) {
        // Update local state
        message.is_read = true;
        console.log(`[Messages] ✓ Message ${message.id} marked as read`);
      } else {
        console.error('[Messages] Failed to mark message as read:', data);
      }
    }
  } catch (err) {
    console.error('[Messages] ❌ Error with message:', err);
    showToast('Error al abrir mensaje', 'error');
  }
};

/**
 * Close message detail view
 */
const closeMessageDetail = () => {
  selectedMessage.value = null;
};

/**
 * Focus map on hex from message
 * @param {string} h3_index - The H3 index to focus on
 */
const focusOnHexFromMessage = (h3_index) => {
  if (!h3_index) return;

  try {
    const [lat, lng] = cellToLatLng(h3_index);
    map.flyTo([lat, lng], 11, {
      duration: 1.0
    });
    console.log(`[Messages] Focused map on ${h3_index}`);
    showToast('Mapa enfocado en territorio', 'success');

    // Close message detail after focusing
    closeMessageDetail();
  } catch (err) {
    console.error('[Messages] Error focusing on hex:', err);
    showToast('Error al enfocar en el mapa', 'error');
  }
};

/**
 * Format message date for display
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted relative time
 */
const formatMessageDate = (dateString) => {
  if (!dateString) return '';

  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return `Hace ${diffMins}m`;
    if (diffHours < 24) return `Hace ${diffHours}h`;
    if (diffDays < 7) return `Hace ${diffDays}d`;

    // Format as date if older than a week
    const day = date.getDate();
    const month = date.getMonth() + 1;
    return `${day}/${month}`;
  } catch (err) {
    console.error('[Messages] Error formatting date:', err);
    return '';
  }
};

/**
 * Show central harvest banner
 * @param {string} season - The harvest season (PRIMAVERA or VERANO)
 */
const showHarvestBanner = (season) => {
  // Create banner element
  const banner = document.createElement('div');
  banner.className = 'harvest-banner';
  banner.innerHTML = `
    <div class="harvest-banner-content">
      <div class="harvest-wheat">🌾</div>
      <div class="harvest-text">
        ✨ ¡COSECHA DE ${season} FINALIZADA! ✨
        <div class="harvest-subtext">Se han recolectado suministros en todo el reino</div>
      </div>
      <div class="harvest-wheat">🌾</div>
    </div>
  `;

  // Add to document
  document.body.appendChild(banner);

  // Trigger animation
  setTimeout(() => {
    banner.classList.add('harvest-banner-show');
  }, 10);

  // Remove after 4 seconds
  setTimeout(() => {
    banner.classList.remove('harvest-banner-show');
    setTimeout(() => {
      document.body.removeChild(banner);
    }, 500);
  }, 4000);
};

/**
 * Render H3 hexagons on the map
 * Ajusta estilos dinámicamente según la resolución:
 * - Res 8: weight 1, opacity 0.8 (hexágonos más grandes, bordes normales)
 * - Res 10: weight 0.5, opacity 0.6 (hexágonos más pequeños, bordes más finos)
 * - has_road: Borde más grueso y color dorado para indicar vías romanas
 * @param {Array} hexagons - Array of {h3_index, name, color, has_road, settlement}
 */
const renderHexagons = (hexagons) => {
  // Clear existing hexagons
  hexagonLayer.clearLayers();

  // Update player's owned hexagons for adjacency checks
  const newPlayerHexes = new Set();
  hexagons.forEach(hex => {
    if (hex.player_id === playerId.value) {
      newPlayerHexes.add(hex.h3_index);
    }
  });
  playerHexes.value = newPlayerHexes;
  console.log(`Player owns ${playerHexes.value.size} territories`);

  console.log(`Rendering ${hexagons.length} hexagons at resolution ${currentResolution.value}...`);

  // Ajustar estilos según resolución
  const isHighRes = currentResolution.value >= 10;
  // const baseBorderWeight = isHighRes ? 0.5 : 1; // Unused in new design logic but kept for reference
  
  // New Rendering Logic with Panes
  hexagons.forEach((hex, index) => {
    try {
      // Get boundary coordinates for this H3 cell
      const boundary = cellToBoundary(hex.h3_index);

      // --- CONFIGURATION ---
      // Calcular estilos usando funciones externas
      const styles = getHexagonStyles(hex, {
        playerId: playerId.value,
        showTerrainLayer: showTerrainLayer.value,
        isPoliticalView: isPoliticalView.value,
        isHighRes
      });

      const { fillColor, fillOpacity, borderColor, borderWeight } = styles;
      const isCapital = hex.is_capital === true;

      // Apply user's opacity slider on top of semantic opacity
      const effectiveFillOpacity = fillOpacity * (hexagonOpacity.value / 100);

      // --- LAYER 1: FILL (territoryPane) ---
      // "A) El RELLENO: L.polygon con fill: true, fillColor: '#ff0000', fillOpacity: 0.3, stroke: false y pane: 'territoryPane'."
      const fillPolygon = L.polygon(boundary, {
        pane: 'territoryPane',
        stroke: false,
        fill: true,
        fillColor: fillColor,
        fillOpacity: effectiveFillOpacity,
        // Make this the interactive layer
        interactive: true
      });

      // Store semantic opacity so updateHexagonOpacity can recalculate correctly
      fillPolygon._semanticFillOpacity = fillOpacity;

      // Hover effects on Fill — use current rendered opacity, not stale closure
      fillPolygon.on('mouseover', function () {
        this.setStyle({
          fillOpacity: Math.min(this.options.fillOpacity + 0.2, 1.0)
        });
      });
      fillPolygon.on('mouseout', function () {
        // Restore to semantic × current slider (persistent after slider changes)
        this.setStyle({
          fillOpacity: this._semanticFillOpacity * (hexagonOpacity.value / 100)
        });
      });

      // Click interaction - Delegated to MapInteractionController
      const [lat, lng] = cellToLatLng(hex.h3_index);
      fillPolygon.on('click', async function () {
        MapInteractionController.handleMapClick(hex.h3_index, {
          // Modo normal: abrir popup del hexágono
          onNormal: async (h3Index) => {
            await showCellDetailsPopup(h3Index, [lat, lng]);
          },
          // Modo selección: procesar movimiento del ejército, flota o personaje
          onSelectDestination: dispatchMovement,
          // Modo selección: procesar movimiento de trabajadores
          onSelectWorkerDestination: async (workerId, fromH3, targetH3) => {
            await processWorkerMovement(workerId, fromH3, targetH3);
          },
        });
      });

      // Right-click to cancel selection (army or worker movement)
      fillPolygon.on('contextmenu', function (e) {
        L.DomEvent.preventDefault(e);
        if (MapInteractionController.isSelectingDestination()) {
          window.cancelArmyMovement();
        } else if (MapInteractionController.isSelectingWorkerDestination()) {
          MapInteractionController.cancelSelection();
          if (map) map.getContainer().style.cursor = '';
          showToast('Movimiento cancelado', 'info');
        }
      });

      fillPolygon.addTo(hexagonLayer);


      // --- LAYER 2: BORDER (borderPane) ---
      // "B) El BORDE: L.polygon con fill: false, color: '#d32f2f', weight: 3, y pane: 'borderPane'."
      const borderPolygon = L.polygon(boundary, {
        pane: 'borderPane',
        fill: false,
        color: borderColor,
        weight: borderWeight,
        opacity: 0.8,
        interactive: false, // Click-through to fill
        className: isCapital ? 'capital-hexagon' : '' // Keep class for possible CSS overrides
      });

      borderPolygon.addTo(hexagonLayer);


      // --- LAYER 3: CROWN MARKER (starPane) ---
      if (isCapital) {
        const [lat, lng] = cellToLatLng(hex.h3_index);

        const crownHtml = `<div style="
          background:#5c2e00;
          border:2px solid #FFD700;
          border-radius:50%;
          width:30px;height:30px;
          display:flex;align-items:center;justify-content:center;
          font-size:16px;
          box-shadow:0 0 10px 3px rgba(255,215,0,0.55),0 2px 6px rgba(0,0,0,0.7);
          user-select:none;">👑</div>`;

        const capitalIcon = L.divIcon({
          html: crownHtml,
          className: '',
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });

        L.marker([lat, lng], {
          icon: capitalIcon,
          pane: 'starPane',
          interactive: false,
          zIndexOffset: 1000,
        }).addTo(hexagonLayer);
      }

      // --- LAYER 3b: BRIDGE MARKER (starPane) ---
      if (hex.is_bridge) {
        const [bLat, bLng] = cellToLatLng(hex.h3_index);

        const bridgeHtml = `<div style="
          background:#1a3a5c;
          border:2px solid #64b5f6;
          border-radius:6px;
          width:30px;height:30px;
          display:flex;align-items:center;justify-content:center;
          font-size:16px;
          box-shadow:0 0 8px 2px rgba(100,181,246,0.45),0 2px 6px rgba(0,0,0,0.7);
          user-select:none;">🌉</div>`;

        const bridgeIcon = L.divIcon({
          html:       bridgeHtml,
          className:  '',
          iconSize:   [30, 30],
          iconAnchor: [15, 15],
        });

        L.marker([bLat, bLng], {
          icon:        bridgeIcon,
          pane:        'starPane',
          interactive: false,
          zIndexOffset: 999,
        }).addTo(hexagonLayer);
      }

    } catch (err) {
      console.error(`Error rendering hexagon ${hex.h3_index}:`, err);
    }
  });

  console.log(`✓ Finished rendering ${hexagons.length} hexagons at resolution ${currentResolution.value}`);

  // Render building and settlement markers if zoom is sufficient
  if (currentZoom.value >= MIN_ZOOM_SETTLEMENTS) {
    renderBuildingMarkers(hexagons);
    renderSettlementMarkers(hexagons);
  } else {
    clearSettlementMarkers();
    clearBuildingMarkers();
  }
};

/**
 * Get SVG icon for settlement type
 * Returns embedded SVG string for better rendering quality
 */
const getSettlementSVG = (type) => {
  const svgIcons = {
    city: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <g filter="drop-shadow(0 2px 4px rgba(0,0,0,0.5))">
        <rect x="8" y="14" width="6" height="14" fill="#8B4513" stroke="#5D2E0F" stroke-width="1"/>
        <rect x="18" y="14" width="6" height="14" fill="#8B4513" stroke="#5D2E0F" stroke-width="1"/>
        <rect x="11" y="8" width="10" height="20" fill="#A0522D" stroke="#5D2E0F" stroke-width="1"/>
        <polygon points="16,3 10,10 22,10" fill="#CD853F" stroke="#5D2E0F" stroke-width="1"/>
        <rect x="13" y="16" width="3" height="4" fill="#4A4A4A"/>
        <rect x="17" y="16" width="2" height="3" fill="#4A4A4A"/>
        <circle cx="16" cy="8" r="1.5" fill="#FFD700"/>
      </g>
    </svg>`,
    town: `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <g filter="drop-shadow(0 2px 3px rgba(0,0,0,0.4))">
        <rect x="6" y="12" width="7" height="14" fill="#8B4513" stroke="#5D2E0F" stroke-width="1"/>
        <rect x="15" y="12" width="7" height="14" fill="#8B4513" stroke="#5D2E0F" stroke-width="1"/>
        <polygon points="9.5,6 5,12 14,12" fill="#A0522D" stroke="#5D2E0F" stroke-width="1"/>
        <polygon points="18.5,6 14,12 23,12" fill="#A0522D" stroke="#5D2E0F" stroke-width="1"/>
        <rect x="8" y="16" width="2" height="3" fill="#4A4A4A"/>
        <rect x="17" y="16" width="2" height="3" fill="#4A4A4A"/>
      </g>
    </svg>`,
    village: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <g filter="drop-shadow(0 2px 3px rgba(0,0,0,0.4))">
        <rect x="6" y="10" width="12" height="12" fill="#8B4513" stroke="#5D2E0F" stroke-width="1"/>
        <polygon points="12,3 4,10 20,10" fill="#A0522D" stroke="#5D2E0F" stroke-width="1"/>
        <rect x="10" y="14" width="4" height="8" fill="#4A4A4A"/>
        <circle cx="9" cy="14" r="1" fill="#FFD700"/>
      </g>
    </svg>`,
    fort: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <g filter="drop-shadow(0 2px 4px rgba(0,0,0,0.5))">
        <rect x="4" y="12" width="24" height="16" fill="#696969" stroke="#2F2F2F" stroke-width="1.5"/>
        <rect x="12" y="6" width="8" height="22" fill="#808080" stroke="#2F2F2F" stroke-width="1.5"/>
        <rect x="6" y="12" width="4" height="4" fill="#505050"/>
        <rect x="22" y="12" width="4" height="4" fill="#505050"/>
        <rect x="14" y="18" width="4" height="10" fill="#4A4A4A"/>
        <polygon points="16,2 13,6 19,6" fill="#696969" stroke="#2F2F2F" stroke-width="1"/>
        <rect x="15" y="4" width="2" height="4" fill="#DC143C"/>
      </g>
    </svg>`,
    monastery: `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <g filter="drop-shadow(0 2px 3px rgba(0,0,0,0.4))">
        <rect x="8" y="10" width="12" height="16" fill="#8B7355" stroke="#5D4E37" stroke-width="1"/>
        <polygon points="14,3 7,10 21,10" fill="#A0826D" stroke="#5D4E37" stroke-width="1"/>
        <rect x="12" y="14" width="4" height="6" fill="#4A4A4A"/>
        <rect x="13" y="5" width="2" height="7" fill="#8B7355"/>
        <line x1="11" y1="6" x2="17" y2="6" stroke="#8B7355" stroke-width="2"/>
        <circle cx="14" cy="10" r="1.5" fill="#FFD700"/>
      </g>
    </svg>`
  };
  return svgIcons[type] || svgIcons['city'];
};

/**
 * Render settlement markers with custom medieval icons and halo labels
 * Solo se renderizan si el zoom es >= MIN_ZOOM_SETTLEMENTS
 * @param {Array} hexagons - Array of hexagons with settlement data
 */
const renderSettlementMarkers = (hexagons) => {
  // Clear existing settlement markers and map
  settlementMarkersLayer.clearLayers();
  settlementMarkersMap = {};

  // Filter hexagons that have settlements
  const settlementsToRender = hexagons.filter(hex => hex.settlement);

  if (settlementsToRender.length === 0) {
    return;
  }

  console.log(`Rendering ${settlementsToRender.length} settlement markers...`);

  settlementsToRender.forEach((hex) => {
    try {
      // Get center coordinates
      const [lat, lng] = cellToLatLng(hex.h3_index);

      // Get SVG icon for settlement type
      const svgIcon = getSettlementSVG(hex.settlement.type);

      // Create custom divIcon with embedded SVG
      const settlementIcon = L.divIcon({
        className: 'settlement-marker',
        html: `<div class="settlement-icon-svg">${svgIcon}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
      });

      // Create marker
      const marker = L.marker([lat, lng], {
        icon: settlementIcon,
        zIndexOffset: 1000, // Ensure markers are on top
      });

      // Add permanent tooltip with enhanced halo effect
      const tooltipContent = `<span class="settlement-label">${hex.settlement.name}</span>`;
      marker.bindTooltip(tooltipContent, {
        permanent: true,
        direction: 'top',
        className: 'settlement-tooltip',
        offset: [0, -20],
      });

      // Add detailed popup on click with coordinates
      let popupContent = `<div style="font-family: 'Cinzel', Georgia, serif;">`;
      popupContent += `<strong style="font-size: 16px; color: #2c1810;">${hex.settlement.name}</strong><br>`;
      popupContent += `<div style="color: #666; font-size: 11px; margin: 5px 0; padding: 3px; background: #f0f0f0; border-radius: 3px;">`;
      popupContent += `📍 Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
      popupContent += `</div>`;
      popupContent += `<strong>Tipo:</strong> ${hex.settlement.type}<br>`;
      if (hex.settlement.population_rank) {
        popupContent += `<strong>Rango:</strong> ${hex.settlement.population_rank}/10<br>`;
      }
      popupContent += `</div>`;

      marker.bindPopup(popupContent);

      // Add to layer
      marker.addTo(settlementMarkersLayer);

      // Store marker in map for navigation
      settlementMarkersMap[hex.settlement.name] = marker;
    } catch (err) {
      console.error(`Error rendering settlement marker for ${hex.h3_index}:`, err);
    }
  });

  console.log(`✓ Rendered ${settlementsToRender.length} settlement markers`);
};

/**
 * Clear all settlement markers from the map
 */
const clearSettlementMarkers = () => {
  if (settlementMarkersLayer) {
    settlementMarkersLayer.clearLayers();
  }
};

/**
 * Render building markers (farms, castles, mines, etc.)
 * Only shows buildings that DON'T have a settlement marker (to avoid overlap)
 * Also renders CAPITAL markers (crown icon) for player capitals
 * @param {Array} hexagons - Array of hexagons with building data
 */
const renderBuildingMarkers = (hexagons) => {
  // Clear existing building markers
  if (buildingMarkersLayer) {
    buildingMarkersLayer.clearLayers();
  }

  // Filter capital hexagons (for crown markers)
  const capitalsToRender = hexagons.filter(hex => hex.is_capital === true);

  if (capitalsToRender.length === 0) {
    return;
  }

  console.log(`Rendering ${capitalsToRender.length} capital markers...`);
};

/**
 * Clear all building markers from the map
 */
const clearBuildingMarkers = () => {
  if (buildingMarkersLayer) {
    buildingMarkersLayer.clearLayers();
  }
};

/**
 * Update opacity of all hexagons
 */
const updateHexagonOpacity = () => {
  localStorage.setItem('feudos_transparency', hexagonOpacity.value);
  const sliderMultiplier = hexagonOpacity.value / 100;
  hexagonLayer.eachLayer((layer) => {
    if (layer.setStyle && layer._semanticFillOpacity !== undefined) {
      // Multiply semantic opacity (own=1.0, enemy=0.6…) by slider to preserve distinctions
      layer.setStyle({
        fillOpacity: layer._semanticFillOpacity * sliderMultiplier,
      });
    }
  });
};

/**
 * Close the action panel
 */
const closeActionPanel = () => {
  showActionPanel.value = false;
  selectedHexData.value = null;

  // Reset colonizing state to ensure clean state for next interaction
  isColonizing.value = false;
};

/**
 * Open the Edictos panel for a given fief
 */
const openFueroPanel = (h3_index, fiefName = '') => {
  fueroPanelH3.value = h3_index;
  fueroPanelFiefName.value = fiefName;
  showFueroPanel.value = true;
};

/**
 * Highlight selected fiefs on the map with a gold overlay (for division selection)
 * @param {string[]} h3Indices
 */
const highlightDivisionFiefs = (h3Indices) => {
  if (!divisionHighlightLayer) return;
  divisionHighlightLayer.clearLayers();
  for (const h3_index of h3Indices) {
    try {
      const boundary = cellToBoundary(h3_index, true);
      L.polygon(boundary, {
        fillColor:   '#c5a059',
        fillOpacity: 0.35,
        color:       '#e8d5b5',
        weight:      2,
        opacity:     0.8,
        interactive: false,
      }).addTo(divisionHighlightLayer);
    } catch (_) { /* ignore invalid h3 */ }
  }
};

/**
 * Clear the division highlight layer
 */
const clearDivisionHighlights = () => {
  if (divisionHighlightLayer) divisionHighlightLayer.clearLayers();
};

/**
 * Fetch all active division boundary GeoJSON from the server and render them
 * as a political border layer. Called on map init and after each proclamation.
 */
const fetchDivisionBoundaries = async () => {
  if (!divisionBoundaryLayer) return;
  try {
    const fc = await mapApi.getDivisionBoundaries();
    divisionBoundaryLayer.clearLayers();
    if (!fc || !fc.features || fc.features.length === 0) return;

    // Fill layer — non-interactive so clicks pass through to the hexagons below
    L.geoJSON(fc, {
      pane: 'divisionBorderPane',
      interactive: false,
      style: () => ({
        stroke: false,
        fillColor: '#8B1A1A',
        fillOpacity: 0.06,
      }),
    }).addTo(divisionBoundaryLayer);

    // Border layer — interactive only on the stroke line, no fill area to block clicks
    L.geoJSON(fc, {
      pane: 'divisionBorderPane',
      style: () => ({
        color: '#8B1A1A',
        weight: 3,
        opacity: 0.88,
        fill: false,
        lineJoin: 'round',
        lineCap: 'round',
      }),
      onEachFeature: (feature, layer) => {
        const props = feature.properties;

        layer.bindTooltip(
          `<div class="division-boundary-tooltip"><strong>⚜️ ${props.name}</strong><br><small>${props.territory_name}</small></div>`,
          { sticky: true, className: 'leaflet-division-tooltip' }
        );

        layer.on('click', () => {
          if (props.player_id == playerId.value) {
            openFueroPanel(props.capital_h3, props.name);
          } else {
            layer.openPopup();
          }
        });

        layer.bindPopup(
          `<div style="font-family: serif; padding: 4px 2px;">
            <strong style="color: #8B1A1A; font-size: 1rem;">⚜️ ${props.name}</strong><br>
            <small style="color: #666;">${props.territory_name} de otro senor</small>
          </div>`
        );
      },
    }).addTo(divisionBoundaryLayer);
  } catch (err) {
    console.error('[Fronteras] Error al cargar fronteras de divisiones:', err);
  }
};

/**
 * Called after a division is successfully proclaimed
 */
const onDivisionProclaimed = () => {
  clearDivisionHighlights();
  fetchHexagonData();
  fetchDivisionBoundaries();
};

/**
 * Open the action panel at mouse position with hex data
 * @param {Object} hexData - Hexagon data from API
 * @param {Object} event - Leaflet mouse event
 */
const openActionPanel = (hexData, event) => {
  selectedHexData.value = hexData;

  // CRITICAL: Reset colonizing state when selecting a new territory
  // This prevents the button from staying disabled if user switches territories during/after colonization
  isColonizing.value = false;

  // Get mouse position relative to the viewport
  const mouseX = event.originalEvent.clientX;
  const mouseY = event.originalEvent.clientY;

  // Position panel near the click, with offset to avoid covering the hex
  actionPanelPosition.value = {
    x: Math.min(mouseX + 10, window.innerWidth - 320), // 320px = panel width
    y: Math.min(mouseY + 10, window.innerHeight - 250)  // 250px = approx panel height
  };

  showActionPanel.value = true;
};

/**
 * Colonize territory (claim hexagon for player)
 * Calls POST /api/game/claim and updates UI on success
 * NOTE: This is the old action panel version, now replaced by colonizeFromPopup
 */
const colonizeTerritory = async () => {
  if (!selectedHexData.value) return;

  // Prevent multiple simultaneous colonization attempts
  if (isColonizing.value) {
    console.log('[Colonize] Already colonizing, ignoring request');
    return;
  }

  try {
    isColonizing.value = true;
    const hexToColonize = selectedHexData.value.h3_index;

    console.log(`[Colonize] Attempting to claim ${hexToColonize} for player ${playerId.value}`);

    // Call API
    const data = await mapApi.claimTerritory(hexToColonize);

    if (data.success) {
      // Update player gold
      playerGold.value = data.new_gold;

      // Close action panel
      closeActionPanel();

      // Refresh the map to show the new territory
      console.log(`✓ Territory claimed successfully! New gold: ${playerGold.value}`);
      await fetchHexagonData();

      // Show success toast
      const message = data.is_capital
        ? '👑 ¡Capital fundada! Tu reino comienza aquí.'
        : '🏰 ¡Territorio colonizado! Recursos añadidos.';
      showToast(message, 'success');
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    console.error('❌ Error colonizing territory:', err);

    // Show error message from server or generic error
    const errorMsg = err.response?.data?.message || err.message || 'Error desconocido';
    showToast(errorMsg, 'error');
  } finally {
    // CRITICAL: Always reset the colonizing state, even if there was an error
    isColonizing.value = false;
    console.log('[Colonize] State reset, ready for next colonization');
  }
};

/**
 * Toggle H3 layer visibility
 */
const toggleH3Layer = () => {
  if (!map || !hexagonLayer) return;

  if (showH3Layer.value) {
    // Mostrar capa H3
    map.addLayer(hexagonLayer);
    // Cargar hexágonos si el zoom es válido
    loadHexagonsIfZoomValid();
    console.log('✓ Malla H3 activada');
  } else {
    // Ocultar capa H3
    map.removeLayer(hexagonLayer);
    // Limpiar hexágonos de memoria
    clearHexagons();
    console.log('✓ Malla H3 desactivada');
  }
};

/**
 * Toggle Political View - Resalta territorios controlados por jugadores
 * Redibuja el mapa sin hacer un nuevo fetch
 */
const togglePoliticalView = () => {
  if (!map) return;

  if (isPoliticalView.value) {
    console.log('✓ Vista Política activada: resaltando territorios de jugadores');
    if (divisionBoundaryLayer) map.addLayer(divisionBoundaryLayer);
  } else {
    console.log('✓ Vista Política desactivada: mostrando vista normal');
    if (divisionBoundaryLayer) map.removeLayer(divisionBoundaryLayer);
  }

  // Redibujar el mapa con los nuevos estilos
  loadHexagonsIfZoomValid();
};

/**
 * Toggle terrain layer visibility
 */
const toggleTerrainLayer = () => {
  if (!map) return;

  if (showTerrainLayer.value) {
    console.log('✓ Capa de Terreno activada');
  } else {
    console.log('✓ Capa de Terreno desactivada');
  }

  // Redibujar el mapa con los nuevos estilos
  loadHexagonsIfZoomValid();
};

/**
 * Get terrain capacity by name
 * @param {string} terrainName - Name of the terrain type
 * @returns {string} Formatted capacity (e.g., "10k")
 */
const getTerrainCapacity = (terrainName) => {
  const capacities = {
    'Plains': '10k',
    'Grass': '8k',
    'Forest': '4k',
    'Hills': '1.5k',
    'Swamp': '800',
    'Desert': '500',
    'Tundra': '500'
  };
  return capacities[terrainName] || '1k';
};

/**
 * Toggle legend collapsed/expanded state
 */
const toggleLegend = () => {
  legendCollapsed.value = !legendCollapsed.value;
  console.log(`✓ Leyenda ${legendCollapsed.value ? 'colapsada' : 'expandida'}`);
};

/**
 * Toggle panel visibility
 * @param {string} panelName - Name of the panel to toggle
 */
const togglePanel = (panelName) => {
  if (activePanel.value === panelName) {
    // Close if already open
    if (panelName === 'notifications') onNotificationsPanelClose();
    activePanel.value = null;
    console.log(`✓ Panel cerrado: ${panelName}`);
  } else {
    // If switching away from notifications, mark all as unread
    if (activePanel.value === 'notifications') onNotificationsPanelClose();

    // Open the new panel (closes any other panel and any open overlay)
    activePanel.value = panelName;
    activeOverlay.value = null;
    console.log(`✓ Panel abierto: ${panelName}`);

    // Reset infinite scroll when opening kingdom panel
    if (panelName === 'kingdom') {
      displayedFiefsCount.value = FIEFS_PER_PAGE;
      loadMyDivisions();
    }
    if (panelName === 'notifications') {
      fetchNotifications(); // refresh con spinner al abrir el panel
    }
    if (panelName === 'market') {
      fetchMyWorkers();
      loadWorkerHireLocations();
    }
  }
};

/**
 * Close the active panel
 */
const closePanel = () => {
  if (activePanel.value === 'notifications') onNotificationsPanelClose();
  activePanel.value = null;
  console.log('✓ Panel cerrado');
};

const onNotificationsPanelClose = () => {
  // No action needed — notifications are marked read per-tab when viewed
};

/**
 * Open full-screen overlay
 */
const openOverlay = (overlayName) => {
  if (activeOverlay.value === overlayName) {
    closeOverlay();
    return;
  }
  activeOverlay.value = overlayName;
  activePanel.value = null; // Close any open panel
  console.log(`✓ Overlay abierto: ${overlayName}`);

  if (overlayName === 'troops') {
    fetchTroops();
  }
  if (overlayName === 'reino') {
    loadMyDivisions();
  }
  if (overlayName === 'characters') {
    fetchAndRenderCharacters();
  }
};

/**
 * Close the active overlay
 */
const closeOverlay = () => {
  const wasOverlay = activeOverlay.value;
  activeOverlay.value = null;
  selectedMessage.value = null;
  if (wasOverlay === 'naval') newFleetId.value = null;
  console.log('✓ Overlay cerrado');
  if (wasOverlay === 'troops' || wasOverlay === 'reino') {
    fetchArmyData();
  }
};

/**
 * Fly to an H3 cell from the Admin Panel (e.g. bot capital)
 */
const handleAdminGoToHex = (h3_index) => {
  closeOverlay();
  if (!map || !h3_index) return;
  try {
    const [lat, lng] = cellToLatLng(h3_index);
    map.flyTo([lat, lng], 11, { duration: 1.2 });
  } catch { /* índice H3 inválido */ }
};

/**
 * Select a message to view in detail
 */
const selectMessage = async (message) => {
  selectedMessage.value = message;

  // Load thread messages
  if (message.thread_id) {
    try {
      const data = await mapApi.getMessageThread(message.thread_id);
      if (data.success) {
        threadMessages.value = data.messages;
      }
    } catch (error) {
      console.error('Error loading thread (GET /api/messages/thread/):', error);
      threadMessages.value = [];
    }
  } else {
    threadMessages.value = [];
  }

  // Mark message as read if it's unread and we're the receiver
  if (!message.is_read && message.receiver_id === playerId.value) {
    try {
      await mapApi.markMessageAsRead(message.id);
      message.is_read = true;
      console.log(`✓ Message ${message.id} marked as read`);
    } catch (error) {
      console.error('Error marking message as read (PUT /api/messages/:id/read):', error);
    }
  }
};

/**
 * Reply to a message
 */
const replyToMessage = (message) => {
  // Determine recipient (if we sent it, reply to receiver; if we received it, reply to sender)
  const isOurMessage = message.sender_id === playerId.value;
  messageRecipient.value = isOurMessage ? message.receiver_username : message.sender_username;

  // Add Re: to subject if not already there
  messageSubject.value = message.subject.startsWith('Re:')
    ? message.subject
    : `Re: ${message.subject}`;

  messageBody.value = '';
  parentMessage.value = message; // Store parent message for threading

  showToast('📝 Formulario preparado para responder', 'info');
};

/**
 * Send a new message
 */
const sendMessage = async () => {
  if (!messageRecipient.value || !messageSubject.value || !messageBody.value) {
    showToast('Por favor completa todos los campos', 'warning');
    return;
  }

  try {
    sendingMessage.value = true;

    const payload = {
      recipient_username: messageRecipient.value,
      subject: messageSubject.value,
      body: messageBody.value
    };

    // If replying to a message, include parent_id
    if (parentMessage.value) {
      payload.parent_id = parentMessage.value.id;
    }

    const data = await mapApi.sendMessage(payload);

    if (data.success) {
      // Show success toast
      showToast('📨 Mensaje entregado al mensajero real', 'success');
      // Clear only subject and body, keep recipient for convenience
      messageSubject.value = '';
      messageBody.value = '';
      parentMessage.value = null;
      // Reload messages
      await loadMessages();
    } else {
      showToast('Error al enviar mensaje: ' + (data.message || 'Error desconocido'), 'error');
    }
  } catch (error) {
    console.error('Error sending message (POST /api/messages):', error);
    showToast('Error al enviar mensaje: ' + (error.response?.data?.message || error.message), 'error');
  } finally {
    sendingMessage.value = false;
  }
};

/**
 * Go to map location from message
 */
const goToMessageLocation = (h3Index) => {
  if (!h3Index) return;
  closeOverlay();
  focusOnHex(h3Index);
};

/**
 * Handle scroll event in fiefs list for infinite scroll
 * @param {Event} event - Scroll event
 */
const handleFiefsScroll = (event) => {
  const element = event.target;
  const scrollBottom = element.scrollHeight - element.scrollTop - element.clientHeight;

  // If scrolled near bottom (within 100px) and not currently loading
  if (scrollBottom < 100 && !loadingMoreFiefs.value && displayedFiefsCount.value < myFiefs.value.length) {
    loadingMoreFiefs.value = true;

    // Simulate loading delay
    setTimeout(() => {
      displayedFiefsCount.value = Math.min(
        displayedFiefsCount.value + FIEFS_PER_PAGE,
        myFiefs.value.length
      );
      loadingMoreFiefs.value = false;
      console.log(`✓ Feudos cargados: ${displayedFiefsCount.value} / ${myFiefs.value.length}`);
    }, 300);
  }
};

/**
 * Focus on a specific hexagon with highlight
 * @param {string} h3Index - H3 index to focus on
 */
const focusOnHex = async (h3Index) => {
  if (!map || !h3Index) return;

  try {
    // Get coordinates of the hexagon
    const [lat, lng] = cellToLatLng(h3Index);

    // Validate coordinates before moving map
    if (lat === undefined || lng === undefined || isNaN(lat) || isNaN(lng)) {
      console.warn(`[Map] Invalid coordinates for hex ${h3Index}: [${lat}, ${lng}]`);
      return;
    }

    // Center map on hexagon with smooth animation
    map.setView([lat, lng], 12, {
      animate: true,
      duration: 1
    });

    // Remove previous highlight if exists
    if (highlightLayer) {
      map.removeLayer(highlightLayer);
      highlightLayer = null;
    }

    // Create highlight polygon
    const boundary = cellToBoundary(h3Index);
    highlightLayer = L.polygon(boundary, {
      color: '#FFFF00',      // Bright yellow
      weight: 8,
      fillOpacity: 0,        // No fill
      opacity: 1,
      interactive: false     // Don't block clicks
    });

    highlightLayer.addTo(map);

    // Show cell details popup
    await showCellDetailsPopup(h3Index, [lat, lng]);

    console.log(`✓ Focused on hexagon: ${h3Index}`);
  } catch (err) {
    console.error(`Error focusing on hex ${h3Index} (showCellDetailsPopup):`, err);
    showToast('Error: Índice H3 inválido', 'error');
  }
};

/**
 * Navigate to H3 index from search input
 */
const goToH3Index = async () => {
  const raw = searchH3Input.value.trim();

  if (!raw) {
    showToast('Introduce coordenadas (lat lon) o un índice H3', 'warning');
    return;
  }

  // Normalize European decimal comma: "39,589 -0,550" → "39.589 -0.550"
  const normalized = /^-?\d+,\d+\s+-?\d+,\d+$/.test(raw) ? raw.replace(/,/g, '.') : raw;

  // Try lat/lon: accepts "39.589 -0.550", "39.589, -0.550", "39.589,-0.550"
  const coordMatch = normalized.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      showToast('Coordenadas fuera de rango', 'error');
      return;
    }
    const h3Index = latLngToCell(lat, lng, 7);
    await focusOnHex(h3Index);
    return;
  }

  // Try H3 index (15-char hex string)
  if (/^[0-9a-f]{15}$/i.test(raw)) {
    await focusOnHex(raw);
    return;
  }

  showToast('Formato no reconocido. Usa "lat lon" o un índice H3', 'error');
};

/**
 * Navigate to player's capital
 */
const goToCapital = async () => {
  try {
    // Use cached capital if available
    if (capitalH3Index.value) {
      await focusOnHex(capitalH3Index.value);
      showToast('Navegando a tu capital ⭐', 'success');
      return;
    }

    // Fetch capital from game/capital endpoint (uses is_capital flag in h3_map)
    const response = await mapApi.getCapital();

    if (!response.success) {
      showToast(response.message, 'warning');
      return;
    }

    // Cache the capital location
    capitalH3Index.value = response.h3_index;

    await focusOnHex(response.h3_index);
    showToast('Navegando a tu capital ⭐', 'success');
  } catch (err) {
    console.error('Error navigating to capital (GET /api/game/capital):', err);

    // Handle 404 specifically (no capital yet)
    if (err.response?.status === 404) {
      showToast('Aún no has colonizado tu primer territorio', 'warning');
    } else {
      showToast('Error al buscar la capital', 'error');
    }
  }
};

/**
 * Format number with K/M suffix
 * @param {number} value - Number to format
 * @returns {string} Formatted string (e.g., 2315 -> "2.3k", 12345677 -> "12.3M")
 */
const formatNumber = (value) => {
  if (value === null || value === undefined || isNaN(value)) return '0';

  const num = Number(value);

  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k';
  } else {
    return num.toString();
  }
};

/**
 * Format gold with 2 decimals (since it's scarce and low volume)
 * @param {number} value - Gold amount to format
 * @returns {string} Formatted string with 2 decimals (e.g., 1.25)
 */
const formatGold = (value) => {
  if (value === null || value === undefined || isNaN(value)) return '0.00';
  return Number(value).toFixed(2);
};


/**
 * Focus on fief and close kingdom panel
 * @param {string} h3Index - H3 index to focus on
 */
const focusOnFiefAndClose = async (h3Index) => {
  if (!h3Index) return;

  // Close the kingdom panel
  activeOverlay.value = null;

  // Focus on the hexagon
  await focusOnHex(h3Index);
};

/**
 * Get toast icon based on type
 */
const getToastIcon = (type) => {
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  return icons[type] || 'ℹ️';
};

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type of toast (success, error, warning, info)
 */
const showToast = (message, type = 'info') => {
  const id = toastIdCounter++;
  const toast = {
    id,
    message,
    type,
    isLeaving: false
  };

  toasts.value.push(toast);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    // Start leave animation
    const toastIndex = toasts.value.findIndex(t => t.id === id);
    if (toastIndex !== -1) {
      toasts.value[toastIndex].isLeaving = true;

      // Remove from array after animation completes
      setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id);
      }, 300); // Match CSS animation duration
    }
  }, 3000);
};

/**
 * Show detailed cell information popup
 * Fetches full cell details from API and displays in Leaflet popup
 */
const showCellDetailsPopup = async (h3_index, latLng) => {
  try {
    // CRITICAL: Reset colonizing state when opening a new popup
    // This ensures the button works correctly even if user switches territories during/after colonization
    isColonizing.value = false;

    // Fetch detailed cell information from API (always fresh data from server)
    const cell = await mapApi.getCellDetails(h3_index);
    console.log(`[Popup] Data for ${h3_index}:`, cell);

    // Build popup HTML content using external generator
    const popupContent = generateCellPopupContent(cell, {
      playerId: playerId.value,
      playerGold: playerGold.value,
      playerHexes: playerHexes.value,
      playerCapitalH3: capitalH3Index.value,
      currentTurn: currentTurn.value,
      isColonizing: isColonizing.value,
      isExiled: isExiled.value,
      explorationConfig: explorationConfig.value,
      h3_index,
      workerTypes: workerTypes.value,
    });

    // Create and show popup
    const popup = L.popup({
      maxWidth: 350,
      className: 'cell-details-popup'
    })
      .setLatLng(latLng)
      .setContent(popupContent)
      .openOn(map);

    // Add event listener to colonize button (if exists)
    if (!cell.player_id) {
      setTimeout(() => {
        const colonizeBtn = document.getElementById(`colonize-btn-${h3_index}`);
        if (colonizeBtn) {
          colonizeBtn.addEventListener('click', () => {
            colonizeFromPopup(h3_index);
          });
        }
      }, 100);
    }

    // Add event listener to build button (own fief with no building)
    if (cell.player_id === playerId.value && !cell.fief_building) {
      setTimeout(() => {
        const buildBtn = document.getElementById(`build-btn-${h3_index}`);
        if (buildBtn) {
          buildBtn.addEventListener('click', () => {
            map.closePopup();
            openBuildModal(h3_index);
          });
        }
      }, 100);
    }

    // Add event listener to repair button (own fief with building conservation < 100)
    if (cell.player_id === playerId.value && cell.fief_building &&
        !cell.fief_building.is_under_construction && (cell.fief_building.conservation ?? 100) < 100) {
      setTimeout(() => {
        const repairBtn = document.getElementById(`repair-btn-${h3_index}`);
        if (repairBtn) {
          repairBtn.addEventListener('click', () => repairBuildingFromPopup(h3_index));
        }
      }, 100);
    }

    // Add event listener to upgrade button (own fief with completed building that has an upgrade)
    if (cell.player_id === playerId.value && cell.fief_building && !cell.fief_building.is_under_construction && cell.fief_building.upgrade) {
      setTimeout(() => {
        const upgradeBtn = document.getElementById(`upgrade-btn-${h3_index}`);
        if (upgradeBtn) {
          upgradeBtn.addEventListener('click', () => {
            const upgrade = JSON.parse(upgradeBtn.dataset.upgrade);
            map.closePopup();
            openUpgradeModal(h3_index, upgrade);
          });
        }
      }, 100);
    }

    // Add event listener to recruit button (own fief with completed military building)
    if (cell.player_id === playerId.value && cell.fief_building &&
        !cell.fief_building.is_under_construction && cell.fief_building.type_name === 'military') {
      setTimeout(() => {
        const recruitBtn = document.getElementById(`recruit-btn-${h3_index}`);
        if (recruitBtn) {
          recruitBtn.addEventListener('click', () => {
            map.closePopup();
            const fief = {
              h3_index,
              name: cell.settlement_name || h3_index,
              wood:  cell.territory?.wood  || 0,
              stone: cell.territory?.stone || 0,
              iron:  cell.territory?.iron  || 0,
            };
            openOverlay('reino');
            openRecruitmentForFief(fief);
          });
        }
      }, 100);
    }

    // Add event listener to Nueva Flota button (own fief with completed maritime building)
    if (cell.player_id === playerId.value && cell.fief_building &&
        !cell.fief_building.is_under_construction && cell.fief_building.type_name === 'maritime') {
      setTimeout(() => {
        const newFleetBtn = document.getElementById(`new-fleet-btn-${h3_index}`);
        if (newFleetBtn) {
          newFleetBtn.addEventListener('click', () => {
            map.closePopup();
            createFleetAtHex(h3_index);
          });
        }
      }, 100);
    }

    // Add event listener to Edictos button (own fief with completed Fortaleza)
    if (cell.player_id === playerId.value && cell.fief_building &&
        !cell.fief_building.is_under_construction && cell.fief_building.name === 'Fortaleza') {
      setTimeout(() => {
        const fueroBtn = document.getElementById(`fueros-btn-${h3_index}`);
        if (fueroBtn) {
          fueroBtn.addEventListener('click', () => {
            map.closePopup();
            openFueroPanel(h3_index, cell.settlement_name || cell.custom_name || h3_index);
          });
        }
      }, 100);
    }

    // Add event listener to hire-worker button (own Capital or fief with active economic building)
    const isOwnFief = cell.player_id === playerId.value;
    const hasMarket = isOwnFief && cell.fief_building &&
      cell.fief_building.type_name === 'economic' &&
      !cell.fief_building.is_under_construction &&
      (cell.fief_building.conservation ?? 100) > 20;
    if (isOwnFief && (cell.is_capital || hasMarket) && workerTypes.value.length > 0) {
      setTimeout(() => {
        const buyBtn = document.getElementById(`buy-worker-btn-${h3_index}`);
        if (buyBtn) {
          buyBtn.addEventListener('click', () => {
            const select = document.getElementById(`worker-type-select-${h3_index}`);
            const worker_type_id = parseInt(select?.value);
            if (worker_type_id) buyWorkerFromPopup(h3_index, worker_type_id);
          });
        }
      }, 100);
    }

  } catch (error) {
    console.error('Error fetching cell details:', error);
    showToast('Error al cargar información del territorio', 'error');
  }
};

/**
 * Activa el modo de movimiento para un ejército desde el popup del mapa.
 * Cierra el popup y cualquier overlay para dejar el mapa despejado.
 * Definida antes de showArmyDetailsPopup para evitar falsos positivos de TypeScript.
 */
const handleArmyMove = (army) => {
  map.closePopup();
  if (activeOverlay.value === 'troops') activeOverlay.value = null;
  window.startArmyMovement(army.army_id, army.name, army.h3_index);
};

const handleCharacterMove = (char) => {
  map.closePopup();
  window.startCharacterMovement(char.id, char.name, char.h3_index);
};

const handleCharacterStop = async (char) => {
  try {
    await mapApi.stopCharacter(char.id);
    RouteVisualizer.clearArmy(`char_${char.id}`);
    map.closePopup();
    await fetchAndRenderCharacters();
    showToast(`🛑 ${char.name} detenido. Ruta cancelada.`, 'info');
  } catch (err) {
    showToast(`❌ ${err?.response?.data?.message || 'Error al retirar personaje'}`, 'error');
  }
};

const handleCharacterJoin = async (char) => {
  try {
    const data = await mapApi.getArmiesAtHex(char.h3_index);
    // El endpoint ya filtra por player_id del jugador autenticado
    const ownArmy = data.armies?.[0];
    if (!ownArmy) {
      showToast('⚠️ No hay ejército propio en este feudo', 'warning');
      return;
    }
    await mapApi.assignArmyCommander(ownArmy.army_id, char.id);
    map.closePopup();
    await fetchAndRenderCharacters();
    showToast(`✅ ${char.name} se ha unido al ejército`, 'success');
  } catch (err) {
    showToast(`❌ ${err?.response?.data?.message || 'Error al unirse al ejército'}`, 'error');
  }
};

const handleCharacterLeave = async (char) => {
  try {
    await mapApi.removeArmyCommander(char.army_id);
    map.closePopup();
    await fetchAndRenderCharacters();
    showToast(`🚪 ${char.name} ha abandonado el ejército`, 'info');
  } catch (err) {
    showToast(`❌ ${err?.response?.data?.message || 'Error al abandonar el ejército'}`, 'error');
  }
};

const handleEnemyCharacterCapture = async (char) => {
  try {
    const result = await mapApi.captureCharacter(char.id);
    map.closePopup();
    showToast(`⛓️ ${result.message}`, 'success');
    await fetchAndRenderCharacters();
  } catch (err) {
    showToast(`❌ ${err?.response?.data?.message || 'Error al capturar el personaje'}`, 'error');
  }
};

// Open transfer panel from map popup
const handleArmySplit = (army) => {
  const ownArmiesAtHex = _pp_armies.filter(
    a => a.player_id === playerId.value && a.army_id !== army.army_id && !a.destination
  );
  if (ownArmiesAtHex.length === 0) {
    showToast('No hay otros ejércitos propios en esta casilla', 'info');
    return;
  }
  map.closePopup();
  transferPanelArmyAId.value  = army.army_id;
  transferPanelArmyBId.value  = ownArmiesAtHex.length === 1 ? ownArmiesAtHex[0].army_id : null;
  transferPanelHex.value      = _pp_h3;
  transferPanelFiefName.value = army.location_name || _pp_h3;
  showTransferPanel.value     = true;
};
const handleArmyMerge = async (army) => {
  try {
    const result = await mapApi.mergeArmies(army.army_id, _pp_h3);
    map.closePopup();
    showToast(`⚔️ ${result.message}`, 'success');
    await Promise.all([fetchTroops(), fetchArmyData()]);
  } catch (err) {
    const msg = err?.response?.data?.message || 'Error al fusionar ejércitos';
    showToast(`❌ ${msg}`, 'error');
  }
};
const handleArmySupply = (_army) => showToast('⚙️ Función "Abastecer" próximamente', 'info');

const handleArmyCommander = async (army, h3_index) => {
  try {
    if (army.commander) {
      // Retirar comandante actual
      await mapApi.removeArmyCommander(army.army_id);
      map.closePopup();
      await fetchAndRenderCharacters();
      showToast(`🚪 Comandante retirado del ejército`, 'info');
    } else {
      // Asignar personaje disponible en el hex
      const char = _char_cache.find(c => c.h3_index === h3_index && !c.army_id);
      if (!char) {
        showToast('⚠️ No hay personaje disponible en este feudo', 'warning');
        return;
      }
      await mapApi.assignArmyCommander(army.army_id, char.id);
      map.closePopup();
      await fetchAndRenderCharacters();
      showToast(`✅ ${char.name} lidera ahora el ejército`, 'success');
    }
  } catch (err) {
    showToast(`❌ ${err?.response?.data?.message || 'Error al gestionar comandante'}`, 'error');
  }
};

/**
 * Attaches click listeners to action buttons of the currently visible army in the popup.
 * Called after popup renders (setTimeout) and after each navigation step.
 */
const attachArmyListeners = (army, h3_index) => {
  if (army.player_id !== playerId.value) return;

  const moveBtn = document.getElementById(`army-move-${army.army_id}`);
  if (moveBtn && !moveBtn.disabled) moveBtn.addEventListener('click', () => handleArmyMove(army));

  const stopBtn = document.getElementById(`army-stop-${army.army_id}`);
  if (stopBtn && !stopBtn.disabled) stopBtn.addEventListener('click', () => handleArmyStop(army));

  const conquerBtn = document.getElementById(`army-conquer-${army.army_id}`);
  if (conquerBtn) conquerBtn.addEventListener('click', () => handleArmyConquer(army, h3_index));

  const splitBtn = document.getElementById(`army-split-${army.army_id}`);
  if (splitBtn) splitBtn.addEventListener('click', () => handleArmySplit(army));

  const mergeBtn = document.getElementById(`army-merge-${army.army_id}`);
  if (mergeBtn && !mergeBtn.disabled) mergeBtn.addEventListener('click', () => handleArmySplit(army));

  const supplyBtn = document.getElementById(`army-supply-${army.army_id}`);
  if (supplyBtn) supplyBtn.addEventListener('click', () => handleArmySupply(army));

  const commanderBtn = document.getElementById(`army-commander-${army.army_id}`);
  if (commanderBtn && !commanderBtn.disabled) commanderBtn.addEventListener('click', () => handleArmyCommander(army, h3_index));
};

/** Retorna si hay un ejército propio con Exploradores en el hex y su army_id, y el primer ejército propio para atacar. */
const _getScoutingInfo = (armies) => {
  const EXPLORER = 'Explorador';
  const scout = armies.find(a =>
    a.player_id === playerId.value &&
    a.units?.some(u => u.unit_name === EXPLORER)
  );
  const ownArmy = armies.find(a => a.player_id === playerId.value);
  return {
    hasExplorersAtHex: !!scout,
    scoutingArmyId: scout?.army_id ?? null,
    attackingArmyId: ownArmy?.army_id ?? null
  };
};

/** Adjunta listeners a los botones de un ejército ENEMIGO en el popup. */
const attachEnemyListeners = (army) => {
  if (army.player_id === playerId.value) return;

  const attackBtn = document.getElementById(`army-attack-${army.army_id}`);
  if (attackBtn && !attackBtn.disabled) {
    attackBtn.addEventListener('click', () => handleArmyAttackFromPopup(army));
  }

  const scoutBtn = document.getElementById(`army-scout-${army.army_id}`);
  if (scoutBtn && !scoutBtn.disabled) {
    scoutBtn.addEventListener('click', () => handleArmyScout(army));
  }
};

// Global bridge: called by ◀/▶ buttons inside the Leaflet popup HTML
window.armyPopupNavigate = (delta) => {
  const newIndex = _pp_index + delta;
  if (newIndex < 0 || newIndex >= _pp_items.length || !_pp_ref) return;
  _pp_index = newIndex;

  const item = _pp_items[_pp_index];

  if (item.type === 'character') {
    const newContent = _generateCharacterItemHTML(item.data, _pp_items.length, _pp_index);
    _pp_ref.setContent(newContent);
    setTimeout(() => attachCharacterListeners(item.data), 50);
    return;
  }

  if (item.type === 'fleet') {
    const newContent = _generateFleetItemHTML(item.data, _pp_items.length, _pp_index);
    _pp_ref.setContent(newContent);
    setTimeout(() => attachFleetListeners(item.data), 50);
    return;
  }

  // Army item
  const { hasExplorersAtHex, scoutingArmyId, attackingArmyId } = _getScoutingInfo(_pp_armies);
  const characterAtHex = _char_cache.find(c => c.h3_index === _pp_h3 && !c.army_id) ?? null;
  // armyIndex = position within armies sub-array
  const armyIndex = _pp_items.slice(0, _pp_index).filter(i => i.type === 'army').length;
  const newContent = generateArmyPopup({ armies: _pp_armies }, {
    currentPlayerId: playerId.value,
    h3_index: _pp_h3,
    coord_x: _pp_coords.x,
    coord_y: _pp_coords.y,
    hexOwnerId: _pp_coords.ownerId,
    currentIndex: armyIndex,
    totalItems: _pp_items.length,
    globalIndex: _pp_index,
    hasExplorersAtHex,
    scoutingArmyId,
    attackingArmyId,
    characterAtHex
  });
  _pp_ref.setContent(newContent);
  setTimeout(() => {
    const army = _pp_armies[armyIndex];
    if (army.player_id === playerId.value) attachArmyListeners(army, _pp_h3);
    else attachEnemyListeners(army);
  }, 50);
};

// Builds the character inspector HTML for the popup navigation
const _generateCharacterItemHTML = (char, totalItems, globalIndex) => {
  const btnStyle = 'background:#1e1e38;border:1px solid #3a3a5c;color:#e2e8f0;border-radius:4px;padding:3px 11px;font-size:1rem;line-height:1;cursor:pointer;';
  const btnDisStyle = btnStyle + 'opacity:0.3;cursor:not-allowed;';
  const prevDis = globalIndex === 0;
  const nextDis = globalIndex === totalItems - 1;
  const icon = char.is_main_character ? '👑' : (char.is_heir ? '🤴' : '⭐');
  const role = char.is_main_character ? 'Líder' : (char.is_heir ? 'Heredero' : 'Personaje');
  const healthPct = Math.round((char.health ?? 100));
  const healthColor = healthPct > 66 ? '#4caf50' : healthPct > 33 ? '#ff9800' : '#f44336';

  let html = '<div class="army-inspector">';

  // Nav bar
  html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;background:rgba(0,0,0,0.45);border-bottom:1px solid #2d2d4a;margin-bottom:4px;">`;
  html += `<button onclick="event.stopPropagation();window.armyPopupNavigate(-1)" ${prevDis ? 'disabled' : ''} style="${prevDis ? btnDisStyle : btnStyle}">◀</button>`;
  html += `<span style="font-family:sans-serif;font-size:0.72rem;color:#6b7280;letter-spacing:1.5px;text-transform:uppercase;">${icon} ${role} · ${globalIndex + 1}/${totalItems}</span>`;
  html += `<button onclick="event.stopPropagation();window.armyPopupNavigate(1)" ${nextDis ? 'disabled' : ''} style="${nextDis ? btnDisStyle : btnStyle}">▶</button>`;
  html += `</div>`;

  // Character card
  html += `<div style="padding:12px 14px;">`;
  html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">`;
  html += `<span style="font-size:2rem;">${icon}</span>`;
  html += `<div>`;
  html += `<div style="font-size:1rem;font-weight:700;color:#e8d5a3;">${char.full_title || char.name}</div>`;
  html += `<div style="font-size:0.75rem;color:#8a7a60;margin-top:2px;">${role} · ${char.age} años</div>`;
  html += `</div>`;
  html += `</div>`;

  // Health bar
  html += `<div style="margin-bottom:8px;">`;
  html += `<div style="display:flex;justify-content:space-between;font-size:0.7rem;color:#8a7a60;margin-bottom:3px;"><span>❤️ Salud</span><span>${healthPct}%</span></div>`;
  html += `<div style="background:rgba(0,0,0,0.4);border-radius:3px;height:6px;overflow:hidden;">`;
  html += `<div style="width:${healthPct}%;height:100%;background:${healthColor};border-radius:3px;transition:width 0.3s;"></div>`;
  html += `</div></div>`;

  // Combat stats if available
  if (char.attack_skill || char.defense_skill || char.leadership_skill) {
    html += `<div style="display:flex;gap:8px;font-size:0.75rem;color:#a89060;margin-bottom:8px;">`;
    if (char.attack_skill)    html += `<span>⚔️ Atq ${char.attack_skill}</span>`;
    if (char.defense_skill)   html += `<span>🛡️ Def ${char.defense_skill}</span>`;
    if (char.leadership_skill) html += `<span>📯 Lid ${char.leadership_skill}</span>`;
    html += `</div>`;
  }

  // Action buttons
  const isMoving = !!char.destination;
  const actionBtnBase = 'padding:5px 10px;border:none;border-radius:4px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;';
  html += `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px;">`;
  html += `<button id="char-pp-move-${char.id}" style="${actionBtnBase}background:#1e40af;">📍 Mover</button>`;
  html += `<button id="char-pp-stop-${char.id}" ${isMoving ? '' : 'disabled'} style="${actionBtnBase}background:${isMoving ? '#7c3aed' : '#374151'};opacity:${isMoving ? 1 : 0.5};cursor:${isMoving ? 'pointer' : 'not-allowed'};">🛑 Detener</button>`;
  html += `<button id="char-pp-join-${char.id}" style="${actionBtnBase}background:#065f46;">🔗 Unirse</button>`;
  html += `</div>`;

  html += `</div></div>`;
  return html;
};

const attachCharacterListeners = (char) => {
  const moveBtn = document.getElementById(`char-pp-move-${char.id}`);
  const stopBtn = document.getElementById(`char-pp-stop-${char.id}`);
  const joinBtn = document.getElementById(`char-pp-join-${char.id}`);
  if (moveBtn) moveBtn.addEventListener('click', () => handleCharacterMove(char));
  if (stopBtn) stopBtn.addEventListener('click', () => handleCharacterStop(char));
  if (joinBtn) joinBtn.addEventListener('click', () => handleCharacterJoin(char));
};

// Builds the fleet inspector HTML for the popup navigation
const _generateFleetItemHTML = (fleet, totalItems, globalIndex) => {
  const fid = fleet.army_id;
  const hasDestination = !!fleet.destination;
  const btnStyle    = 'background:#1e1e38;border:1px solid #3a3a5c;color:#e2e8f0;border-radius:4px;padding:3px 11px;font-size:1rem;line-height:1;cursor:pointer;';
  const btnDisStyle = btnStyle + 'opacity:0.3;cursor:not-allowed;';
  const prevDis = globalIndex === 0;
  const nextDis = globalIndex === totalItems - 1;
  const actionBtnBase = 'padding:5px;border:none;border-radius:4px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;';

  let html = '<div class="army-inspector">';

  // Nav bar
  html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;background:rgba(0,0,0,0.45);border-bottom:1px solid #2d2d4a;margin-bottom:4px;">`;
  html += `<button onclick="event.stopPropagation();window.armyPopupNavigate(-1)" ${prevDis ? 'disabled' : ''} style="${prevDis ? btnDisStyle : btnStyle}">◀</button>`;
  html += `<span style="font-family:sans-serif;font-size:0.72rem;color:#6b7280;letter-spacing:1.5px;text-transform:uppercase;">⛵ Flota · ${globalIndex + 1}/${totalItems}</span>`;
  html += `<button onclick="event.stopPropagation();window.armyPopupNavigate(1)" ${nextDis ? 'disabled' : ''} style="${nextDis ? btnDisStyle : btnStyle}">▶</button>`;
  html += `</div>`;

  // Fleet card
  html += `<div style="padding:12px 14px;font-family:sans-serif;font-size:13px;">`;
  html += `<strong style="font-size:14px;">⛵ ${fleet.name}</strong><br>`;
  html += `<div style="display:flex;gap:10px;font-size:11px;color:#6b7280;margin:4px 0 6px;">`;
  html += `<span>🚢 ${fleet.total_ships} barcos</span><span>📦 ${fleet.total_capacity} capacidad</span>`;
  html += `</div>`;
  if (hasDestination) {
    html += `<div style="font-size:11px;color:#f59e0b;margin-bottom:6px;">→ En marcha</div>`;
  }
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px;">`;
  html += `<button id="fl-move-${fid}" style="${actionBtnBase}background:#1e40af;">➡️ Moverse</button>`;
  html += `<button id="fl-stop-${fid}" ${hasDestination ? '' : 'disabled'} style="${actionBtnBase}background:${hasDestination ? '#7c3aed' : '#374151'};opacity:${hasDestination ? 1 : 0.45};cursor:${hasDestination ? 'pointer' : 'not-allowed'};">⏹ Detenerse</button>`;
  html += `<button id="fl-embark-${fid}" style="${actionBtnBase}background:#065f46;">⚓ Embarcar</button>`;
  html += `<button id="fl-disembark-${fid}" style="${actionBtnBase}background:#7c2d12;">🏖️ Desembarcar</button>`;
  html += `</div>`;
  html += `<div id="fl-panel-${fid}" style="margin-top:8px;font-size:12px;"></div>`;
  html += `</div></div>`;
  return html;
};

// Attaches action listeners to fleet buttons inside the navigation popup
const attachFleetListeners = (fleet) => {
  const fid = fleet.army_id;

  document.getElementById(`fl-move-${fid}`)?.addEventListener('click', () => {
    map.closePopup();
    window.startFleetMovement(fid, fleet.name, fleet.h3_index);
  });

  const stopBtn = document.getElementById(`fl-stop-${fid}`);
  if (stopBtn && !stopBtn.disabled) {
    stopBtn.addEventListener('click', async () => {
      try {
        await mapApi.stopFleet(fid);
        map.closePopup();
        RouteVisualizer.clearArmy(fid);
        showToast(`⏹ ${fleet.name} detenida.`, 'info');
        await fetchHexagonData();
      } catch (err) {
        showToast(`❌ ${err?.response?.data?.message || 'Error al detener la flota'}`, 'error');
      }
    });
  }

  document.getElementById(`fl-embark-${fid}`)?.addEventListener('click', async () => {
    const panel = document.getElementById(`fl-panel-${fid}`);
    if (!panel) return;
    panel.innerHTML = '<span style="color:#9ca3af;">Cargando...</span>';
    try {
      const data = await mapApi.getEmbarkableArmies(fid);
      const armies  = data.armies               || [];
      const chars   = data.standalone_characters || [];
      const workers = data.standalone_workers    || [];
      const rowStyle = 'display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #374151;';
      const btnGreen = 'padding:2px 8px;border:none;border-radius:3px;background:#065f46;color:#fff;font-size:11px;cursor:pointer;';
      let html = '';

      if (armies.length) {
        html += `<div style="font-size:10px;color:#9ca3af;margin:4px 0 2px;">⚔️ Ejércitos</div>`;
        html += armies.map(a => {
          const parts = [];
          if (a.troop_count > 0) parts.push(`⚔️ ${a.troop_count}`);
          if (a.char_count  > 0) parts.push(`👑 ${a.char_count}`);
          const label = parts.length ? `${a.name} (${parts.join(' ')})` : a.name;
          return `<div style="${rowStyle}"><span style="font-size:12px;">${label}</span>
            <button onclick="window.doFleetEmbark(${fid},${a.army_id},'${a.name.replace(/'/g, "\\'")}',this)" style="${btnGreen}">Embarcar</button></div>`;
        }).join('');
      }

      if (chars.length) {
        html += `<div style="font-size:10px;color:#9ca3af;margin:4px 0 2px;">👑 Personajes sueltos</div>`;
        html += chars.map(c =>
          `<div style="${rowStyle}"><span style="font-size:12px;">👑 ${c.name}</span>
            <button onclick="window.doFleetEmbarkChar(${fid},${c.id},'${c.name.replace(/'/g, "\\'")}',this)" style="${btnGreen}">Embarcar</button></div>`
        ).join('');
      }

      if (workers.length) {
        html += `<div style="font-size:10px;color:#9ca3af;margin:4px 0 2px;">⛏️ Constructores (${workers.length})</div>`;
        html += workers.map(w =>
          `<div style="${rowStyle}"><span style="font-size:12px;">⛏️ Constructor #${w.id}</span>
            <button onclick="window.doFleetEmbarkWorker(${fid},${w.id},this)" style="${btnGreen}">Embarcar</button></div>`
        ).join('');
      }

      panel.innerHTML = html || '<span style="color:#6b7280;">Nada disponible para embarcar.</span>';
    } catch { panel.innerHTML = '<span style="color:#ef4444;">Error al cargar.</span>'; }
  });

  document.getElementById(`fl-disembark-${fid}`)?.addEventListener('click', async () => {
    const panel = document.getElementById(`fl-panel-${fid}`);
    if (!panel) return;
    panel.innerHTML = '<span style="color:#9ca3af;">Cargando...</span>';
    try {
      const data = await mapApi.getFleetDetail(fid);
      const cargo   = data.fleet?.cargo || {};
      const armies  = cargo.embarked_armies   || [];
      const chars   = cargo.standalone_chars  || [];
      const workers = cargo.standalone_workers || [];
      const rowStyle = 'display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #374151;';
      const btnRed = 'padding:2px 8px;border:none;border-radius:3px;background:#7c2d12;color:#fff;font-size:11px;cursor:pointer;';
      let html = '';

      if (armies.length) {
        html += `<div style="font-size:10px;color:#9ca3af;margin:4px 0 2px;">⚔️ Ejércitos</div>`;
        html += armies.map(a => `<div style="${rowStyle}">
          <span>⚔️ ${a.name} (${a.troop_count})</span>
          <button onclick="window.doFleetDisembark(${a.army_id},'${a.name.replace(/'/g, "\\'")}',${fid},this)" style="${btnRed}">Desembarcar</button>
        </div>`).join('');
      }

      if (chars.length) {
        html += `<div style="font-size:10px;color:#9ca3af;margin:4px 0 2px;">👑 Personajes</div>`;
        html += chars.map(c => `<div style="${rowStyle}">
          <span>👑 ${c.name}</span>
          <button onclick="window.doFleetDisembarkChar(${c.id},'${c.name.replace(/'/g, "\\'")}',${fid},this)" style="${btnRed}">Desembarcar</button>
        </div>`).join('');
      }

      if (workers.length) {
        html += `<div style="font-size:10px;color:#9ca3af;margin:4px 0 2px;">⛏️ Constructores</div>`;
        html += workers.map(w => `<div style="${rowStyle}">
          <span>⛏️ ${w.type_name} #${w.id}</span>
          <button onclick="window.doFleetDisembarkWorker(${w.id},${fid},this)" style="${btnRed}">Desembarcar</button>
        </div>`).join('');
      }

      panel.innerHTML = html || '<span style="color:#6b7280;">Nada embarcado.</span>';
    } catch { panel.innerHTML = '<span style="color:#ef4444;">Error al cargar carga.</span>'; }
  });
};

/**
 * Show detailed army information popup
 * Fetches full army details from API and displays in Leaflet popup
 */
const showArmyDetailsPopup = async (h3_index, latLng) => {
  try {
    console.log(`[Army Popup] Fetching army details for ${h3_index}...`);

    // Fetch detailed army information from API
    const data = await mapApi.getArmyDetails(h3_index);

    if (!data.success) {
      showToast('Error al cargar información del ejército', 'error');
      return;
    }

    console.log(`[Army Popup] Loaded ${data.armies.length} armies at ${h3_index}`);

    // Get cell coordinates if available
    let coord_x = null;
    let coord_y = null;
    let cellData = null;
    try {
      cellData = await mapApi.getCellDetails(h3_index);
      coord_x = cellData.coord_x;
      coord_y = cellData.coord_y;
    } catch (err) {
      console.warn('[Army Popup] Could not fetch coordinates:', err);
    }

    // Reset pagination state for this new popup
    _pp_armies = data.armies ?? [];
    _pp_index = 0;
    _pp_h3 = h3_index;
    _pp_coords = { x: coord_x, y: coord_y, ownerId: cellData?.player_id ?? null };

    // Compute scouting info for the enemy popup button
    const { hasExplorersAtHex, scoutingArmyId, attackingArmyId } = _getScoutingInfo(_pp_armies);

    // Characters at this hex (own, age >= 16, not riding with an army)
    if (_char_cache.length === 0) await fetchAndRenderCharacters();
    const charsAtHex = _char_cache.filter(c => c.h3_index === h3_index && !c.army_id && c.age >= 16);
    const characterAtHex = charsAtHex[0] ?? null; // legacy — for assign-commander button

    // Fleets at this hex (own fleets cached from last fetchHexagonData)
    const fleetsAtHex = _all_fleets.filter(f => f.h3_index === h3_index);

    // Build combined items list: armies → characters → fleets
    _pp_items = [
      ..._pp_armies.map(a => ({ type: 'army',      data: a })),
      ...charsAtHex.map(c => ({ type: 'character', data: c })),
      ...fleetsAtHex.map(f => ({ type: 'fleet',    data: f })),
    ];

    if (_pp_items.length === 0) return;

    // Initial render depends on the type of the first item
    const firstItem = _pp_items[0];
    let popupContent;
    if (firstItem.type === 'fleet') {
      popupContent = _generateFleetItemHTML(firstItem.data, _pp_items.length, 0);
    } else if (firstItem.type === 'character') {
      popupContent = _generateCharacterItemHTML(firstItem.data, _pp_items.length, 0);
    } else {
      popupContent = generateArmyPopup(data, {
        currentPlayerId: playerId.value,
        h3_index,
        coord_x,
        coord_y,
        hexOwnerId: _pp_coords.ownerId,
        currentIndex: 0,
        totalItems: _pp_items.length,
        hasExplorersAtHex,
        scoutingArmyId,
        attackingArmyId,
        characterAtHex
      });
    }

    // Create and show popup — store reference for navigation
    const popup = L.popup({
      maxWidth: 350,
      className: 'army-details-popup'
    })
      .setLatLng(latLng)
      .setContent(popupContent)
      .openOn(map);

    _pp_ref = popup;

    // Attach listeners for the first item after DOM renders
    setTimeout(() => {
      if (firstItem.type === 'fleet') {
        attachFleetListeners(firstItem.data);
      } else if (firstItem.type === 'character') {
        attachCharacterListeners(firstItem.data);
      } else if (_pp_armies.length > 0) {
        const first = _pp_armies[0];
        if (first.player_id === playerId.value) attachArmyListeners(first, h3_index);
        else attachEnemyListeners(first);
      }
    }, 100);

  } catch (error) {
    console.error('Error fetching army details:', error);
    showToast('Error al cargar información del ejército', 'error');
  }
};

/**
 * Colonize territory from popup
 */
const colonizeFromPopup = async (h3_index) => {
  // Prevent multiple simultaneous colonization attempts
  if (isColonizing.value) {
    console.log('[Colonize] Already colonizing, ignoring request');
    return;
  }

  try {
    isColonizing.value = true;
    console.log(`[Colonize] Attempting to claim ${h3_index} for player ${playerId.value}`);

    // Call API
    const data = await mapApi.claimTerritory(h3_index);

    if (data.success) {
      // Update player gold
      playerGold.value = data.new_gold_balance || data.new_gold;

      // CRITICAL: Immediately add this hex to player's territories for adjacency checks
      playerHexes.value.add(h3_index);
      console.log(`✓ Territory claimed successfully! Player now owns ${playerHexes.value.size} territories`);

      // Close popup
      map.closePopup();

      // Refresh the map to show the new territory
      await fetchHexagonData();

      // Update fiefs list to include new territory
      await updateFiefsUI();

      // Clear exile state if the server confirmed it was cleared
      if (data.was_exiled) {
        isExiled.value = false;
        capitalH3Index.value = h3_index;
      }

      // Show success toast (including iron vein message if found)
      let message = data.was_exiled
        ? '🏕️ ¡Tu reino renace! Has fundado un nuevo asentamiento.'
        : data.is_capital
          ? '👑 ¡Capital fundada! Tu reino comienza aquí.'
          : '🏰 ¡Territorio colonizado!';

      if (data.iron_vein_found && data.iron_message) {
        message += ' ' + data.iron_message;
      }

      if (data.gold_vein_found && data.gold_message) {
        message += ' ' + data.gold_message;
      }

      showToast(message, 'success');
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    console.error('❌ Error colonizing territory (POST /api/game/claim):', err);
    const errorMsg = err.response?.data?.message || err.message || 'Error desconocido';
    showToast(errorMsg, 'error');
  } finally {
    // CRITICAL: Always reset the colonizing state, even if there was an error
    isColonizing.value = false;
    console.log('[Colonize] State reset, ready for next colonization');
  }
};

/**
 * Get building icon emoji by building name
 */
const getBuildingIcon = (name = '', typeName = '') => {
  const n = name.toLowerCase();
  const t = (typeName || '').toLowerCase();
  if (n.includes('granja') || n.includes('farm')) return '🌾';
  if (n.includes('astillero') || n.includes('shipyard') ||
      n.includes('portus') || n.includes('cothon') ||
      n.includes('emporio') || n.includes('embarcadero') || t === 'maritime') return '⛵';
  if (n.includes('castellum') || n.includes('fortaleza') || n.includes('castillo')) return '🏰';
  if (n.includes('mina') || n.includes('mine')) return '⛏️';
  if (n.includes('aserradero') || n.includes('lumber')) return '🌲';
  if (n.includes('mercado') || n.includes('market') || n.includes('foro') || n.includes('factor') || n.includes('lonja') || n.includes('feria')) return '⚖️';
  if (t === 'military') return '🏰';
  if (t === 'religious') return '🏛️';
  if (t === 'economic') return '⚖️';
  return '🗼';
};

/**
 * Open the building construction modal for a fief (shows only base buildings)
 */
const openBuildModal = async (h3_index) => {
  try {
    buildModalH3.value = h3_index;
    buildModalBuildings.value = [];
    showBuildModal.value = true;
    const data = await mapApi.getBuildings();
    // Only show buildings with no prerequisite (base-level buildings)
    buildModalBuildings.value = (data.buildings || []).filter(b => !b.required_building_id);
  } catch (err) {
    showToast('Error al cargar catálogo de edificios', 'error');
    showBuildModal.value = false;
  }
};

/**
 * Close the building construction modal
 */
const closeBuildModal = () => {
  showBuildModal.value = false;
  buildModalH3.value = null;
  buildModalBuildings.value = [];
  buildModalOpenedFromWorker.value = false;
};

/**
 * Open the building upgrade modal for a fief
 */
const openUpgradeModal = (h3_index, upgrade) => {
  upgradeModalH3.value = h3_index;
  upgradeModalBuilding.value = upgrade;
  showUpgradeModal.value = true;
};

/**
 * Close the building upgrade modal
 */
const closeUpgradeModal = () => {
  showUpgradeModal.value = false;
  upgradeModalH3.value = null;
  upgradeModalBuilding.value = null;
};

/**
 * Execute fief building upgrade
 */
const doUpgrade = async () => {
  if (isUpgrading.value) return;
  try {
    isUpgrading.value = true;
    const data = await mapApi.upgradeFiefBuilding(upgradeModalH3.value);
    if (data.success) {
      closeUpgradeModal();
      await updateFiefsUI();
      showToast(`🏰 Ampliación iniciada: ${data.building_name}`, 'success');
    } else {
      showToast(data.message || 'Error al iniciar ampliación', 'error');
    }
  } catch (err) {
    showToast(err.response?.data?.message || 'Error al iniciar ampliación', 'error');
  } finally {
    isUpgrading.value = false;
  }
};

/**
 * Start construction of a building in a fief
 */
const doConstruct = async (h3_index, building_id) => {
  if (isConstructing.value) return;
  try {
    isConstructing.value = true;
    const data = await mapApi.constructBuilding(h3_index, building_id);
    if (data.success) {
      playerGold.value = data.new_gold_balance;
      const building = buildModalBuildings.value.find(b => b.id === building_id);
      const buildingName = building?.name || data.building_name || 'edificio';
      closeBuildModal();
      await updateFiefsUI();
      showToast(`🏗️ Construcción iniciada: ${buildingName}`, 'success');
    } else {
      showToast(data.message || 'Error al iniciar construcción', 'error');
    }
  } catch (err) {
    showToast(err.response?.data?.message || 'Error al iniciar construcción', 'error');
  } finally {
    isConstructing.value = false;
  }
};

/**
 * Start exploration from kingdom table
 */
const exploreFiefFromTable = async (h3_index) => {
  try {
    console.log(`[Explore] Starting exploration for ${h3_index} from table`);

    // Call API
    const data = await mapApi.exploreTerritory(h3_index);

    if (data.success) {
      // Update player gold
      playerGold.value = data.new_gold_balance;

      console.log(`✓ Exploration started! Gold spent: ${data.gold_spent}, Ends at turn: ${data.exploration_end_turn}`);

      // Show success toast
      const endTurn = data.exploration_end_turn;
      const msg = endTurn
        ? `⛏️ ¡Exploración iniciada! Finalizará en el turno ${endTurn}.`
        : '⛏️ ¡Exploración iniciada! Los prospectores se han puesto en marcha.';
      showToast(msg, 'success');

      // Refresh the fiefs list to show exploration status
      await updateFiefsUI();
      await fetchHexagonData();
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    console.error('❌ Error starting exploration:', err);
    const errorMsg = err.response?.data?.message || err.message || 'Error desconocido';
    showToast(errorMsg, 'error');
  }
};

/**
 * Upgrade infrastructure in a territory
 */
const upgradeInfrastructure = async (h3_index, building_type) => {
  try {
    console.log(`[Infrastructure] Upgrading ${building_type} in ${h3_index}`);

    // Call API
    const data = await mapApi.upgradeBuilding(h3_index, building_type);

    if (data.success) {
      // Update player gold
      playerGold.value = data.new_gold_balance;

      console.log(`✓ Infrastructure upgraded! ${building_type}: ${data.old_level} → ${data.new_level}`);

      // Close popup
      map.closePopup();

      // Show success toast
      const buildingNames = {
        farm: 'Granja',
        mine: 'Mina',
        lumber: 'Aserradero',
        port: 'Puerto'
      };
      showToast(`🏗️ ${buildingNames[building_type]} mejorada a nivel ${data.new_level}`, 'success');

      // Refresh the map and fiefs list
      await fetchHexagonData();
      await updateFiefsUI();
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    console.error('❌ Error upgrading infrastructure (POST /api/territory/upgrade):', err);
    const errorMsg = err.response?.data?.message || err.message || 'Error desconocido';
    showToast(errorMsg, 'error');
  }
};

/**
 * Fetch available unit types for recruitment
 */
const fetchUnitTypes = async () => {
  try {
    loadingUnitTypes.value = true;
    const data = await mapApi.getUnitTypes();

    if (data.success) {
      unitTypes.value = data.unit_types;
      console.log('✓ Unit types loaded:', unitTypes.value.length);
    }
  } catch (err) {
    console.error('❌ Error fetching unit types:', err);
    showToast('Error al cargar tipos de unidades', 'error');
  } finally {
    loadingUnitTypes.value = false;
  }
};

/**
 * Fetch all troops for the current player
 */
const fetchTroops = async () => {
  try {
    loadingTroops.value = true;
    const data = await mapApi.getArmies();

    if (data.success) {
      armies.value = data.armies;
      console.log('✓ Armies loaded:', armies.value.length);
    }
  } catch (err) {
    console.error('❌ Error fetching armies:', err);
    showToast('Error al cargar ejércitos', 'error');
  } finally {
    loadingTroops.value = false;
  }
};

const fetchArmyCapacity = async () => {
  try {
    const data = await mapApi.getArmyCapacity();
    if (data.success) {
      armyCount.value = data.army_count;
      armyLimit.value = data.army_limit;
    }
  } catch (err) {
    console.error('❌ Error fetching army capacity:', err);
  }
};

/**
 * Handle locate event from TroopsPanel
 * Centers the map on the specified troop location
 */
const handleLocateTroop = ({ h3_index, army_name, army_id }) => {
  try {
    if (!map) {
      showToast('El mapa aún no está inicializado', 'error');
      return;
    }

    const [lat, lng] = cellToLatLng(h3_index);
    map.flyTo([lat, lng], 11, {
      duration: 1.0
    });

    // Close troops overlay to see the map
    closeOverlay();

    showToast(`🔍 Localizando ${army_name}`, 'info');
    console.log(`[Troops] Focused on army ${army_id} at ${h3_index}`);
  } catch (err) {
    console.error('❌ Error locating troop:', err);
    showToast('Error al localizar tropas en el mapa', 'error');
  }
};

const handleArmyStopped = async (armyId) => {
  // Remove route line from map immediately
  RouteVisualizer.clearArmy(armyId);
  // Refresh armies list to clear destination field
  await fetchTroops();
  showToast('⏹ Ejército detenido y ruta cancelada', 'info');
};

const handleArmyDismissed = async ({ message, armyDissolved }) => {
  await Promise.all([fetchTroops(), fetchArmyData(), fetchHexagonData()]);
  showToast(message || '✅ Tropas licenciadas', 'success');
  if (armyDissolved) RouteVisualizer.clearAll?.();
};

const handleArmiesTransferred = async () => {
  await Promise.all([fetchTroops(), fetchArmyData()]);
};

/**
 * Maneja el resultado de un ataque manual lanzado desde TroopsPanel.
 * Refresca ejércitos y marcadores del mapa, muestra resultado al jugador.
 */
const handleArmyAttacked = async (battle) => {
  // Refrescar inmediatamente tropas y marcadores
  await Promise.all([fetchTroops(), fetchArmyData()]);

  if (!battle) {
    showToast('⚔️ Combate resuelto', 'info');
    return;
  }

  if (battle.isDraw) {
    showToast(`⚔️ EMPATE en ${battle.h3Index} — ambos ejércitos permanecen`, 'info');
  } else {
    const myArmy  = battle.winner?.playerId === battle.armyA?.playerId ? battle.armyA : battle.armyB;
    const isWin   = battle.winner && myArmy && battle.winner.id === myArmy.id;
    if (isWin) {
      const retreated = battle.armyB?.destroyed ? 'aniquilado' : `retirado a ${battle.armyB?.retreat?.newHex ?? '?'}`;
      showToast(`⚔️ ¡VICTORIA! Bajas propias: ${myArmy.dead} | Enemigo ${retreated}`, 'success');
    } else {
      showToast(`⚔️ DERROTA — tu ejército se retira`, 'error');
    }
  }
};

/**
 * Conquista un territorio enemigo desde el popup del mapa.
 * Llamado por el listener del botón army-conquer-{id} en showArmyDetailsPopup.
 */
const handleArmyConquer = async (army, h3_index) => {
  try {
    const result = await mapApi.conquerFief(army.army_id, h3_index);
    map.closePopup();
    // Mostrar modal de resultado de batalla
    battleSummaryData.value = result;
    battleSummaryVisible.value = true;
    // Refrescar mapa y tropas
    await Promise.all([fetchHexagonData(), fetchTroops(), fetchArmyData()]);
  } catch (err) {
    console.error('[MapViewer] Error al conquistar feudo:', err);
    const msg = err?.response?.data?.message || '❌ Error al conquistar el feudo';
    showToast(msg, 'error');
  }
};

/**
 * Envía una misión de espionaje contra un ejército enemigo desde el popup.
 * Llamado por el listener del botón army-scout-{id} en attachEnemyListeners.
 */
const handleArmyScout = async (enemyArmy) => {
  // Obtener el army_id del explorador desde el atributo del botón
  const btn = document.getElementById(`army-scout-${enemyArmy.army_id}`);
  const rawId = btn ? parseInt(btn.dataset.scoutingArmy, 10) : NaN;
  const scoutingArmyId = Number.isFinite(rawId) ? rawId : null;
  if (!scoutingArmyId) {
    showToast('No se encontró un ejército explorador válido', 'error');
    return;
  }
  try {
    if (btn) btn.disabled = true;
    const result = await mapApi.scoutArmy(scoutingArmyId, enemyArmy.army_id);

    // Mostrar resultado ANTES de cerrar el popup para evitar interferencia con los toasts
    if (result.result === 'fail') {
      showToast(`🔭 Misión fallida — tus exploradores regresaron sin información`, 'warning');
    } else if (result.result === 'partial') {
      const names = (result.data || []).map(u => u.unit_name).join(', ') || '?';
      showToast(`🔭 Espionaje parcial: "${result.target_army_name}" · Tipos: ${names}`, 'info');
    } else {
      const lines = (result.data || []).map(u => `${u.unit_name}: ${u.quantity}`).join(' | ') || '?';
      showToast(`🔭 Espionaje exitoso: "${result.target_army_name}" → ${lines}`, 'success');
    }
    if (result.detected) {
      showToast('👁️ ¡Tus exploradores fueron detectados!', 'warning');
    }

    map.closePopup();
  } catch (err) {
    const msg = err?.response?.data?.error || err?.response?.data?.message || '❌ Error en la misión de espionaje';
    showToast(msg, 'error');
    if (btn) btn.disabled = false;
  }
};

/**
 * Ataca un ejército enemigo desde el popup del mapa.
 * Llamado por el listener del botón army-attack-{id} en attachEnemyListeners.
 */
const handleArmyAttackFromPopup = async (enemyArmy) => {
  const btn = document.getElementById(`army-attack-${enemyArmy.army_id}`);
  const rawId = btn ? parseInt(btn.dataset.attackingArmy, 10) : NaN;
  const attackerArmyId = Number.isFinite(rawId) ? rawId : null;
  if (!attackerArmyId) {
    showToast('No se encontró un ejército atacante válido', 'error');
    return;
  }
  try {
    if (btn) btn.disabled = true;
    map.closePopup();
    const result = await mapApi.attackSpecificArmy(attackerArmyId, enemyArmy.army_id);
    battleSummaryData.value = result;
    battleSummaryVisible.value = true;
    await Promise.all([fetchHexagonData(), fetchTroops(), fetchArmyData()]);
  } catch (err) {
    const msg = err?.response?.data?.message || '❌ Error al atacar el ejército';
    showToast(msg, 'error');
    if (btn) btn.disabled = false;
  }
};


/**
 * Detiene un ejército desde el popup del mapa.
 * Llamado por el listener del botón army-stop-{id} en showArmyDetailsPopup.
 */
const handleArmyStop = async (army) => {
  try {
    await mapApi.stopArmy(army.army_id);
    // Cerrar popup
    map.closePopup();
    // Limpiar línea de ruta del mapa
    RouteVisualizer.clearArmy(army.army_id);
    // Refrescar lista de ejércitos (TroopsPanel) y marcadores del mapa
    await Promise.all([fetchTroops(), fetchArmyData()]);
    showToast(`⏹ ${army.name} detenido. Ruta cancelada.`, 'info');
  } catch (err) {
    console.error('[MapViewer] Error al detener ejército:', err);
    const msg = err?.response?.data?.message || 'Error al detener el ejército';
    showToast(`❌ ${msg}`, 'error');
  }
};

const fetchNotifications = async () => {
  try {
    loadingNotifications.value = true;
    const data = await mapApi.getNotifications();
    if (data.success) {
      notifications.value = data.notifications;
    }
  } catch (err) {
    console.error('❌ Error fetching notifications:', err);
  } finally {
    loadingNotifications.value = false;
  }
};

// Polling silencioso: actualiza notificaciones sin activar el spinner
const pollNotifications = async () => {
  try {
    const data = await mapApi.getNotifications();
    if (data.success) notifications.value = data.notifications;
  } catch {
    // fallo silencioso — no interrumpir la experiencia del usuario
  }
};

const fetchPendingRelations = async () => {
  try {
    const data = await mapApi.getPendingRelations();
    pendingRelationsCount.value = data.pending?.length ?? 0;
  } catch {
    // fallo silencioso
  }
};

const startNotifPolling = () => {
  pollNotifications();      // carga inicial inmediata
  fetchPendingRelations();  // badge inicial
  notifPollIntervalId = setInterval(pollNotifications, NOTIF_POLL_INTERVAL);
};

const stopNotifPolling = () => {
  if (notifPollIntervalId) {
    clearInterval(notifPollIntervalId);
    notifPollIntervalId = null;
  }
};

const handleNotificationRead = async (notif) => {
  if (notif.is_read) return;
  try {
    await mapApi.markNotificationRead(notif.id);
    const target = notifications.value.find(n => n.id === notif.id);
    if (target) target.is_read = true;
  } catch (err) {
    console.error('❌ Error marking notification as read:', err);
  }
};

const handleNotificationsReadTab = async (type) => {
  // Local state already updated optimistically in NotificationsPanel
  try {
    await mapApi.markNotificationsTypeRead(type);
  } catch (err) {
    console.error('Error al marcar tab como leído:', err);
  }
};

/**
 * Switch to military tab for a specific fief
 */
const openRecruitmentForFief = async (fief) => {
  activeKingdomTab.value = 'military';
  selectedRecruitmentFief.value = fief;
  recruitablePool.value = null;

  const [, poolData] = await Promise.all([
    unitTypes.value.length === 0 ? fetchUnitTypes() : Promise.resolve(),
    mapApi.getRecruitablePool(fief.h3_index).catch(() => null),
  ]);
  if (poolData?.success) recruitablePool.value = poolData.recruitable;
};

/**
 * Handle recruitment event from MilitaryPanel
 */
const handleRecruitmentEmit = async ({ fief, army_name, units, mode = 'field' }) => {
  try {
    isRecruiting.value = true;
    const response = await mapApi.bulkRecruit({
      h3_index: fief.h3_index,
      army_name,
      units,
      mode,
    });

    if (response.success) {
      const totalTroops = units.reduce((s, u) => s + u.quantity, 0);
      if (mode === 'garrison') {
        showToast(`🏰 ${totalTroops} tropas acuarteladas en ${fief.name}`, 'success');
      } else {
        showToast(`✅ Batallón "${response.army_name}" reclutado con ${totalTroops} tropas en ${fief.name}`, 'success');
      }
      await fetchPlayerData();
      if (mode === 'field') await fetchArmyCapacity();
      await updateFiefsUI();
      activeKingdomTab.value = 'fiefs';
      selectedRecruitmentFief.value = null;
      recruitablePool.value = null;
    } else {
      showToast(response.message, 'error');
    }
  } catch (err) {
    console.error('❌ Error en reclutamiento masivo:', err);
    showToast(err.response?.data?.message || 'Error al reclutar', 'error');
  } finally {
    isRecruiting.value = false;
  }
};

/**
 * Recruit units
 */
const recruitUnits = async () => {
  if (!selectedRecruitmentFief.value) {
    recruitmentMessage.value = { type: 'error', text: 'Selecciona un feudo' };
    return;
  }
  if (!selectedUnitType.value) {
    recruitmentMessage.value = { type: 'error', text: 'Selecciona un tipo de unidad' };
    return;
  }
  if (recruitmentQuantity.value <= 0) {
    recruitmentMessage.value = { type: 'error', text: 'La cantidad debe ser mayor a 0' };
    return;
  }
  // army_name is optional — backend generates one if empty

  try {
    isRecruiting.value = true;
    recruitmentMessage.value = { type: '', text: '' };

    const response = await mapApi.recruitTroops({
      h3_index: selectedRecruitmentFief.value.h3_index,
      unit_type_id: selectedUnitType.value.id,
      quantity: recruitmentQuantity.value,
      army_name: recruitmentArmyName.value.trim()
    });

    if (response.success) {
      recruitmentMessage.value = {
        type: 'success',
        text: `✓ ${recruitmentQuantity.value} ${selectedUnitType.value.name} reclutado(s) en ${selectedRecruitmentFief.value.name}`
      };

      // Refresh data
      await fetchPlayerData();
      await updateFiefsUI();

      // Reset form
      recruitmentQuantity.value = 1;
      recruitmentArmyName.value = '';
      selectedUnitType.value = null;
    } else {
      recruitmentMessage.value = { type: 'error', text: response.message };
    }
  } catch (err) {
    console.error('❌ Error recruiting units:', err);
    const errorMsg = err.response?.data?.message || err.message || 'Error desconocido';
    recruitmentMessage.value = { type: 'error', text: errorMsg };
  } finally {
    isRecruiting.value = false;
  }
};

/**
 * Get available resources for a fief for recruitment
 */
const getRecruitmentResources = (fief) => {
  if (!fief) return null;
  return {
    wood: fief.wood || 0,
    stone: fief.stone || 0,
    iron: fief.iron || 0,
    gold: playerGold.value
  };
};

/**
 * Check if recruitment is possible for selected unit and fief
 */
const canRecruit = computed(() => {
  if (!selectedRecruitmentFief.value || !selectedUnitType.value || recruitmentQuantity.value <= 0) {
    return false;
  }

  const resources = getRecruitmentResources(selectedRecruitmentFief.value);
  const requirements = selectedUnitType.value.requirements || [];

  for (const req of requirements) {
    const needed = req.amount * recruitmentQuantity.value;
    if (req.resource_type === 'gold' && resources.gold < needed) return false;
    if (req.resource_type === 'wood_stored' && resources.wood < needed) return false;
    if (req.resource_type === 'stone_stored' && resources.stone < needed) return false;
    if (req.resource_type === 'iron_stored' && resources.iron < needed) return false;
  }

  return true;
});

/**
 * Switch to military tab and load unit types
 */
const openMilitaryTab = async () => {
  activeKingdomTab.value = 'military';
  if (unitTypes.value.length === 0) {
    await fetchUnitTypes();
  }
  // Reset recruitment form
  selectedRecruitmentFief.value = null;
  selectedUnitType.value = null;
  recruitmentQuantity.value = 1;
  recruitmentArmyName.value = '';
  recruitmentMessage.value = { type: '', text: '' };
};

/**
 * Calculate total upkeep for selected units
 */
const totalUpkeep = computed(() => {
  if (!selectedUnitType.value || recruitmentQuantity.value <= 0) {
    return { gold: 0, food: 0 };
  }
  return {
    gold: (selectedUnitType.value.gold_upkeep || 0) * recruitmentQuantity.value,
    food: (selectedUnitType.value.food_consumption || 0) * recruitmentQuantity.value
  };
});

/**
 * Fetch the player's own worker list for the market panel.
 * Also called after buying a worker to keep the panel in sync.
 */
const fetchMyWorkers = async () => {
  loadingWorkers.value = true;
  try {
    const data = await mapApi.getMyWorkers();
    if (data.success) {
      myWorkers.value = data.workers;
      // Redibujar rutas de constructores en azul
      data.workers.forEach(w => {
        if (w.destination_h3) {
          RouteVisualizer.drawWorkerPath(w.id, w.h3_index, w.destination_h3);
        } else {
          RouteVisualizer.clearWorker(w.id);
        }
      });
    }
  } catch {
    // Non-critical
  } finally {
    loadingWorkers.value = false;
  }
};

/**
 * Start worker movement from the market panel (closes panel, activates crosshair).
 * @param {number} workerId - ID of the specific worker to move
 * @param {string} fromH3   - Hex where the worker is currently located
 */
const startWorkerMoveFromPanel = (workerId, fromH3) => {
  activePanel.value = null; // Close panel so the map is clickable
  window.startWorkerMovement(fromH3, workerId);
};

/**
 * Start bridge construction from the market panel.
 * @param {string} h3_index
 */
const buildBridgeFromPanel = async (h3_index) => {
  try {
    const result = await mapApi.startBridgeConstruction(h3_index);
    if (result.success) {
      showToast(`🌉 ${result.message}`, 'success');
      await fetchHexagonData();
      await fetchMyWorkers(); // workers consumed — refresh panel list
    } else {
      showToast(`⚠️ ${result.message}`, 'warning');
    }
  } catch (err) {
    const msg = err?.response?.data?.message || 'Error al iniciar la construcción';
    showToast(`❌ ${msg}`, 'error');
  }
};

/**
 * Load worker type definitions once on mount.
 * Stored in workerTypes ref and passed into popup config for the hire form.
 */
const loadWorkerTypes = async () => {
  try {
    const data = await mapApi.getWorkerTypes();
    if (data.success) workerTypes.value = data.worker_types;
  } catch {
    // Non-critical — popup will just hide the hire form
  }
};

/**
 * Hire a worker from the cell popup.
 */
/**
 * Start a bridge construction from the worker map popup.
 * Workers at h3_index are consumed. Only valid on Río / Agua terrain.
 */
const buildBridgeFromPopup = async (h3_index) => {
  try {
    const result = await mapApi.startBridgeConstruction(h3_index);
    if (result.success) {
      showToast(`🌉 ${result.message}`, 'success');
      await fetchHexagonData();
      fetchMyWorkers(); // remove consumed workers from market panel
    } else {
      showToast(`⚠️ ${result.message}`, 'warning');
    }
  } catch (err) {
    const msg = err?.response?.data?.message || 'Error al iniciar la construcción';
    showToast(`❌ ${msg}`, 'error');
  }
};

const repairBuildingFromPopup = async (h3_index) => {
  try {
    const result = await mapApi.repairBuilding({ h3_index });
    if (result.success) {
      showToast(`🔧 ${result.message}`, 'success');
      playerGold.value = Math.max(0, playerGold.value - (result.repair_cost || 0));
      map.closePopup();
      await fetchHexagonData();
    }
  } catch (err) {
    const msg = err?.response?.data?.message || 'Error al reparar el edificio';
    showToast(`❌ ${msg}`, 'error');
  }
};

const buyWorkerFromMarketPanel = async (h3_index, worker_type_id) => {
  try {
    const workerType = workerTypes.value.find(t => t.id === worker_type_id);
    const result = await mapApi.buyWorker({ h3_index, worker_type_id });
    if (result.success) {
      showToast(`⛏️ ${result.message}`, 'success');
      playerGold.value = Math.max(0, playerGold.value - (workerType?.cost ?? 0));
      marketHireTypeId.value = null;
      marketHireH3.value = null;
      await fetchMyWorkers();
    } else {
      showToast(`❌ ${result.message}`, 'error');
    }
  } catch (err) {
    const msg = err?.response?.data?.message || 'Error al contratar trabajador';
    showToast(`❌ ${msg}`, 'error');
  }
};

const buyWorkerFromPopup = async (h3_index, worker_type_id) => {
  try {
    const result = await mapApi.buyWorker({ h3_index, worker_type_id });
    if (result.success) {
      showToast(`⛏️ ${result.message}`, 'success');
      map.closePopup();
      await fetchHexagonData();
      fetchMyWorkers(); // keep market panel in sync
    }
  } catch (err) {
    const msg = err?.response?.data?.message || 'Error al contratar trabajador';
    showToast(`❌ ${msg}`, 'error');
  }
};

/**
 * Creates a new fleet at a port hex and opens the Naval panel.
 */
const createFleetAtHex = async (h3_index) => {
  try {
    const result = await mapApi.createFleet(h3_index);
    if (result.success) {
      showToast(`⛵ Flota "${result.name}" creada en el puerto.`, 'success');
      newFleetId.value = result.fleet_id;
      openOverlay('naval');
    }
  } catch (err) {
    const msg = err?.response?.data?.message || 'Error al crear la flota.';
    showToast(`❌ ${msg}`, 'error');
  }
};

/**
 * Upgrade farm level from KingdomPanel fiefs table.
 */
const handleUpgradeFarmFromTable = async ({ h3_index, cost }) => {
  try {
    const data = await mapApi.upgradeFarm(h3_index);
    if (data.success) {
      showToast(`🌾 ${data.message || 'Granja mejorada'}`, 'success');
      playerGold.value = Math.max(0, playerGold.value - cost);
      const fief = myFiefs.value.find(f => f.h3_index === h3_index);
      if (fief) fief.farm_level = (fief.farm_level || 0) + 1;
    } else {
      showToast(`❌ ${data.message || 'Error al mejorar granja'}`, 'error');
    }
  } catch (err) {
    showToast(`❌ ${err?.response?.data?.message || 'Error al mejorar granja'}`, 'error');
  }
};

/**
 * Hire a worker from the KingdomPanel fiefs table.
 * @param {{ h3_index: string, worker_type_id: number, cost: number }} data
 */
const handleBuyWorkerFromTable = async ({ h3_index, worker_type_id, cost }) => {
  try {
    const result = await mapApi.buyWorker({ h3_index, worker_type_id });
    if (result.success) {
      showToast(`⛏️ ${result.message}`, 'success');
      playerGold.value = Math.max(0, playerGold.value - cost);
      await fetchHexagonData();
      fetchMyWorkers(); // keep market panel in sync
    }
  } catch (err) {
    const msg = err?.response?.data?.message || 'Error al contratar trabajador';
    showToast(`❌ ${msg}`, 'error');
  }
};

/**
 * Check authentication status
 * Loads user session from server
 */
const checkAuth = async () => {
  try {
    console.log('[Auth] Checking authentication...');

    // Try to get user from localStorage first (faster)
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      currentUser.value = JSON.parse(storedUser);
      console.log(`[Auth] ✓ User loaded from localStorage: ${currentUser.value.username} (${currentUser.value.role})`);
    }

    // Verify session with server
    const response = await mapApi.getAuthMe();

    if (response.success) {
      currentUser.value = response.user;
      localStorage.setItem('user', JSON.stringify(response.user));
      console.log(`[Auth] ✓ Session verified: ${currentUser.value.username} (${currentUser.value.role})`);
      if (!response.user.is_initialized) {
        showWelcomePanel.value = true;
        console.log('[Auth] New player detected — showing Epic Initialization panel');
      }
    } else {
      // No session, clear user data and redirect immediately
      currentUser.value = null;
      localStorage.removeItem('user');
      console.log('[Auth] ⚠️ No active session');
      window.location.replace('/login.html');
    }
  } catch (err) {
    // 401 is handled by the global axios interceptor in mapApi.js
    // Only redirect here for non-401 errors (network failures, etc.)
    if (err.response?.status !== 401) {
      console.error('[Auth] Error checking authentication:', err);
      currentUser.value = null;
      localStorage.removeItem('user');
      window.location.replace('/login.html');
    }
  }
};

/**
 * Handle user logout
 * Calls logout API, clears local storage, and redirects to login
 */
const saveProfile = async () => {
  if (savingProfile.value || profileDisplayName.value.trim().length < 2) return;
  savingProfile.value = true;
  try {
    const result = await mapApi.updateProfile(profileDisplayName.value.trim());
    if (result.success) {
      currentUser.value = result.user;
      localStorage.setItem('user', JSON.stringify(result.user));
      showToast(`Nombre actualizado: ${result.user.display_name}`, 'success');
    } else {
      showToast(result.error || 'Error al guardar el nombre', 'error');
    }
  } catch (err) {
    showToast(err?.response?.data?.error || 'Error de conexión', 'error');
  } finally {
    savingProfile.value = false;
  }
};

/**
 * Called when the Epic Initialization panel completes.
 * Updates local user state and centers the map on the new capital.
 */
const onInitDone = ({ capital_h3 } = {}) => {
  showWelcomePanel.value = false;
  // Re-fetch full user data from server so culture_id, culture_name, etc. are up to date
  mapApi.getAuthMe().then(response => {
    if (response.success) {
      currentUser.value = response.user;
      localStorage.setItem('user', JSON.stringify(response.user));
    }
  }).catch(() => {});
  // Center map on the new capital and refresh data
  if (capital_h3) {
    import('h3-js').then(({ cellToLatLng }) => {
      const [lat, lng] = cellToLatLng(capital_h3);
      if (map) map.setView([lat, lng], 13);
    }).catch(() => {});
  }
  // Refresh fiefs, army capacity and division borders
  updateFiefsUI();
  fetchArmyCapacity();
  fetchDivisionBoundaries();
  mapApi.getCapital().then(r => {
    if (r?.success) { capitalH3Index.value = r.h3_index; isExiled.value = r.is_exiled ?? false; }
  }).catch(() => {});
};

/**
 * Called when EconomyPanel reports a gold change (farm upgrade).
 * Syncs the player gold in local state.
 */
const onGoldUpdated = (newGold) => {
  if (currentUser.value) {
    currentUser.value.gold = newGold;
    localStorage.setItem('user', JSON.stringify(currentUser.value));
  }
};

const handleLogout = async () => {
  try {
    console.log('[Auth] Logging out...');

    // Call logout endpoint to destroy session
    const response = await mapApi.logout();

    if (response.success) {
      console.log('[Auth] ✓ Logout successful');
    }
  } catch (err) {
    console.error('[Auth] Error during logout (POST /api/auth/logout):', err);
    // Continue with logout even if API call fails
  } finally {
    // Clear all local storage data
    localStorage.removeItem('user');
    localStorage.removeItem('capitalH3');
    console.log('[Auth] ✓ Local storage cleared');

    // Clear current user state
    currentUser.value = null;

    // Show toast notification
    showToast('Sesión cerrada. ¡Hasta pronto!', 'success');

    // Redirect to login page
    setTimeout(() => {
      window.location.href = '/login.html';
    }, 1000);
  }
};

// Watchers
watch(
  () => activePanel.value,
  (newPanel) => {
    if (newPanel === 'profile') {
      profileDisplayName.value = currentUser.value?.display_name || currentUser.value?.username || '';
    }
  }
);

watch(
  () => activeOverlay.value,
  async (newValue) => {
    // Load capital when opening Kingdom Management panel
    if (newValue === 'reino' && !capitalH3Index.value) {
      try {
        const response = await mapApi.getCapital();
        if (response.success) {
          capitalH3Index.value = response.h3_index;
          isExiled.value = response.is_exiled ?? false;
        }
      } catch (error) {
        console.error('Error loading capital for Kingdom Management:', error);
      }
    }
  }
);

// ============================================
// MAP INTERACTION CONTROLLER SETUP
// ============================================

/**
 * Setup del controlador de interacción del mapa
 * Expone funciones globales y configura callbacks
 */
const setupMapInteractionController = () => {
  // Exponer función global para iniciar movimiento de ejército
  window.startArmyMovement = (armyId, armyName, armyH3) => {
    console.log(`[MapViewer] Iniciando movimiento de ejército: ${armyName} (${armyId}) desde ${armyH3}`);

    // Activar modo de selección en el controlador (guarda armyH3 para la validación de distancia)
    MapInteractionController.startArmyMovement(armyId, armyName, armyH3);

    // Cambiar cursor y mostrar mensaje al usuario
    if (map) {
      map.getContainer().style.cursor = 'crosshair';
    }

    showToast(`🎯 Selecciona el destino para ${armyName}. Click derecho para cancelar.`, 'info');
  };

  // Exponer función global para cancelar selección
  window.cancelArmyMovement = () => {
    MapInteractionController.cancelSelection();
    if (map) {
      map.getContainer().style.cursor = '';
    }
    showToast('Movimiento cancelado', 'info');
  };

  // Exponer función global para iniciar movimiento de un trabajador individual
  window.startWorkerMovement = (fromH3, workerId) => {
    console.log(`[MapViewer] Iniciando movimiento trabajador #${workerId} desde ${fromH3}`);
    MapInteractionController.startWorkerMovement(fromH3, workerId);
    if (map) {
      map.getContainer().style.cursor = 'crosshair';
    }
    showToast('🎯 Selecciona el destino para los trabajadores. Click derecho para cancelar.', 'info');
  };

  // Exponer función global para iniciar movimiento de flota naval
  window.startFleetMovement = (fleetId, fleetName, fleetH3) => {
    MapInteractionController.startArmyMovement(`fleet_${fleetId}`, fleetName, fleetH3);
    if (map) map.getContainer().style.cursor = 'crosshair';
    showToast(`⛵ Selecciona el destino para ${fleetName}. Click derecho para cancelar.`, 'info');
  };

  // Embarcar / Desembarcar desde popup de flota en el mapa
  window.doFleetEmbark = async (fleetId, armyId, armyName, btn) => {
    if (btn) btn.disabled = true;
    try {
      const result = await mapApi.embarkArmy(fleetId, armyId);
      showToast(`✅ ${armyName} embarcado.`, 'success');
      if (result?.warning) showToast(`⚠️ ${result.warning}`, 'warning');
      map.closePopup();
      await fetchHexagonData();
    } catch (err) {
      if (btn) btn.disabled = false;
      showToast(`❌ ${err?.response?.data?.message || 'Error al embarcar'}`, 'error');
    }
  };

  window.doFleetEmbarkChar = async (fleetId, charId, charName, btn) => {
    if (btn) btn.disabled = true;
    try {
      await mapApi.embarkCharacter(fleetId, charId);
      showToast(`✅ ${charName} embarcado.`, 'success');
      map.closePopup();
      await fetchHexagonData();
    } catch (err) {
      if (btn) btn.disabled = false;
      showToast(`❌ ${err?.response?.data?.message || 'Error al embarcar'}`, 'error');
    }
  };

  window.doFleetEmbarkWorker = async (fleetId, workerId, btn) => {
    if (btn) btn.disabled = true;
    try {
      await mapApi.embarkWorker(fleetId, workerId);
      showToast(`✅ Constructor embarcado.`, 'success');
      map.closePopup();
      await fetchHexagonData();
    } catch (err) {
      if (btn) btn.disabled = false;
      showToast(`❌ ${err?.response?.data?.message || 'Error al embarcar'}`, 'error');
    }
  };

  window.doFleetDisembark = async (armyId, armyName, fleetId, btn) => {
    if (btn) btn.disabled = true;
    try {
      const landingData = await mapApi.getLandingHexes(fleetId);
      if (!landingData.is_sea) {
        // Coastal hex: land directly
        await mapApi.disembarkArmy(armyId);
        showToast(`✅ ${armyName} desembarcado.`, 'success');
        map.closePopup();
        await fetchHexagonData();
      } else {
        // Sea hex: need to pick a landing hex
        const hexes = landingData.landing_hexes;
        if (hexes.length === 0) {
          showToast('No hay celdas de tierra adyacentes para desembarcar.', 'error');
          if (btn) btn.disabled = false;
          return;
        }
        if (hexes.length === 1) {
          await mapApi.disembarkArmy(armyId, hexes[0].h3_index);
          showToast(`✅ ${armyName} desembarcado en ${hexes[0].terrain_name}.`, 'success');
          map.closePopup();
          await fetchHexagonData();
        } else {
          // Show inline hex selector in the panel
          const panel = btn?.closest('[id^="fl-panel-"]');
          if (panel) {
            const btnStyle = 'margin:2px;padding:3px 8px;border:none;border-radius:3px;background:#7c2d12;color:#fff;font-size:11px;cursor:pointer;';
            panel.innerHTML = `<div style="font-size:11px;color:#d1d5db;margin-bottom:4px;">⚓ Elige celda de desembarco:</div>` +
              hexes.map(hx => `<button onclick="window.doFleetDisembarkAt(${armyId},'${armyName.replace(/'/g, "\\'")}','${hx.h3_index}','${hx.terrain_name}',this)"
                style="${btnStyle}">🏖️ ${hx.terrain_name} <span style="font-size:9px;opacity:0.6;">${hx.h3_index.slice(0,8)}…</span></button>`
              ).join('');
          } else {
            if (btn) btn.disabled = false;
          }
        }
      }
    } catch (err) {
      if (btn) btn.disabled = false;
      showToast(`❌ ${err?.response?.data?.message || 'Error al desembarcar'}`, 'error');
    }
  };

  window.doFleetDisembarkAt = async (armyId, armyName, targetH3, terrainName, btn) => {
    if (btn) btn.disabled = true;
    try {
      await mapApi.disembarkArmy(armyId, targetH3);
      showToast(`✅ ${armyName} desembarcado en ${terrainName}.`, 'success');
      map.closePopup();
      await fetchHexagonData();
    } catch (err) {
      if (btn) btn.disabled = false;
      showToast(`❌ ${err?.response?.data?.message || 'Error al desembarcar'}`, 'error');
    }
  };

  window.doFleetDisembarkChar = async (charId, charName, fleetId, btn) => {
    if (btn) btn.disabled = true;
    try {
      const landing = await mapApi.getLandingHexes(fleetId);
      if (!landing.is_sea) {
        await mapApi.disembarkCharacter(charId);
        showToast(`✅ ${charName} desembarcado.`, 'success');
        map.closePopup();
        await fetchHexagonData();
      } else if (landing.landing_hexes.length === 1) {
        await mapApi.disembarkCharacter(charId, landing.landing_hexes[0].h3_index);
        showToast(`✅ ${charName} desembarcado en ${landing.landing_hexes[0].terrain_name}.`, 'success');
        map.closePopup();
        await fetchHexagonData();
      } else if (landing.landing_hexes.length > 1) {
        const panel = btn?.closest('[id^="fl-panel-"]');
        if (panel) {
          const btnRed = 'padding:2px 8px;border:none;border-radius:3px;background:#7c2d12;color:#fff;font-size:11px;cursor:pointer;margin:2px;';
          panel.innerHTML = `<div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">Elige dónde desembarcar a ${charName}:</div>` +
            landing.landing_hexes.map(hx =>
              `<button onclick="window.doFleetDisembarkCharAt(${charId},'${charName.replace(/'/g, "\\'")}',${fleetId},'${hx.h3_index}','${hx.terrain_name}',this)" style="${btnRed}">${hx.terrain_name}</button>`
            ).join('');
        }
        if (btn) btn.disabled = false;
      } else {
        showToast('❌ No hay hexes de tierra adyacentes.', 'error');
        if (btn) btn.disabled = false;
      }
    } catch (err) {
      if (btn) btn.disabled = false;
      showToast(`❌ ${err?.response?.data?.message || 'Error al desembarcar'}`, 'error');
    }
  };

  window.doFleetDisembarkCharAt = async (charId, charName, fleetId, targetH3, terrainName, btn) => {
    if (btn) btn.disabled = true;
    try {
      await mapApi.disembarkCharacter(charId, targetH3);
      showToast(`✅ ${charName} desembarcado en ${terrainName}.`, 'success');
      map.closePopup();
      await fetchHexagonData();
    } catch (err) {
      if (btn) btn.disabled = false;
      showToast(`❌ ${err?.response?.data?.message || 'Error al desembarcar'}`, 'error');
    }
  };

  window.doFleetDisembarkWorker = async (workerId, fleetId, btn) => {
    if (btn) btn.disabled = true;
    try {
      const landing = await mapApi.getLandingHexes(fleetId);
      if (!landing.is_sea) {
        await mapApi.disembarkWorker(workerId);
        showToast(`✅ Constructor desembarcado.`, 'success');
        map.closePopup();
        await fetchHexagonData();
      } else if (landing.landing_hexes.length === 1) {
        await mapApi.disembarkWorker(workerId, landing.landing_hexes[0].h3_index);
        showToast(`✅ Constructor desembarcado en ${landing.landing_hexes[0].terrain_name}.`, 'success');
        map.closePopup();
        await fetchHexagonData();
      } else if (landing.landing_hexes.length > 1) {
        const panel = btn?.closest('[id^="fl-panel-"]');
        if (panel) {
          const btnRed = 'padding:2px 8px;border:none;border-radius:3px;background:#7c2d12;color:#fff;font-size:11px;cursor:pointer;margin:2px;';
          panel.innerHTML = `<div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">Elige dónde desembarcar el constructor:</div>` +
            landing.landing_hexes.map(hx =>
              `<button onclick="window.doFleetDisembarkWorkerAt(${workerId},${fleetId},'${hx.h3_index}','${hx.terrain_name}',this)" style="${btnRed}">${hx.terrain_name}</button>`
            ).join('');
        }
        if (btn) btn.disabled = false;
      } else {
        showToast('❌ No hay hexes de tierra adyacentes.', 'error');
        if (btn) btn.disabled = false;
      }
    } catch (err) {
      if (btn) btn.disabled = false;
      showToast(`❌ ${err?.response?.data?.message || 'Error al desembarcar'}`, 'error');
    }
  };

  window.doFleetDisembarkWorkerAt = async (workerId, fleetId, targetH3, terrainName, btn) => {
    if (btn) btn.disabled = true;
    try {
      await mapApi.disembarkWorker(workerId, targetH3);
      showToast(`✅ Constructor desembarcado en ${terrainName}.`, 'success');
      map.closePopup();
      await fetchHexagonData();
    } catch (err) {
      if (btn) btn.disabled = false;
      showToast(`❌ ${err?.response?.data?.message || 'Error al desembarcar'}`, 'error');
    }
  };

  // Exponer función global para iniciar movimiento de personaje
  window.startCharacterMovement = (characterId, characterName, fromH3) => {
    console.log(`[MapViewer] Iniciando movimiento personaje: ${characterName} (${characterId}) desde ${fromH3}`);
    // Reutiliza el modo de selección de ejército pero guarda el contexto como personaje
    MapInteractionController.startArmyMovement(`char_${characterId}`, characterName, fromH3);
    if (map) map.getContainer().style.cursor = 'crosshair';
    showToast(`🎯 Selecciona el destino para ${characterName}. Click derecho para cancelar.`, 'info');
  };

  // Registrar callback para cambios de modo
  MapInteractionController.setOnModeChange((mode, data) => {
    console.log(`[MapViewer] Modo de interacción cambió a: ${mode}`, data);

    // Resetear cursor cuando vuelve a modo normal
    if (mode === 'NORMAL' && map) {
      map.getContainer().style.cursor = '';
    }
  });

  console.log('[MapViewer] ✓ Map Interaction Controller configurado');
};

/**
 * Procesa el movimiento de un ejército a un destino
 * @param {number} armyId - ID del ejército a mover
 * @param {string} targetH3 - Hexágono destino
 * @param {string} armyName - Nombre del ejército (para feedback)
 */
const processCharacterMovement = async (characterId, targetH3, characterName) => {
  try {
    const response = await mapApi.moveCharacter(characterId, targetH3);
    if (response.success) {
      showToast(`✅ ${characterName} en marcha hacia destino`, 'success');
      if (response.path && response.from) {
        RouteVisualizer.drawPath(`char_${characterId}`, response.path, response.from);
      }
      await fetchAndRenderCharacters();
    } else {
      showToast(`⚠️ ${response.message || 'No se pudo mover el personaje'}`, 'warning');
    }
  } catch (error) {
    const msg = error.response?.data?.message || 'Error al mover personaje';
    showToast(`❌ ${msg}`, 'error');
  }
};

/**
 * Dispatcher común para onSelectDestination en todos los handlers del mapa.
 * Enruta según prefijo: fleet_ → processFleetMovement, char_ → processCharacterMovement, resto → processArmyMovement.
 */
const dispatchMovement = async (armyId, targetH3, armyName) => {
  const sid = String(armyId);
  if (sid.startsWith('fleet_')) {
    await processFleetMovement(parseInt(sid.replace('fleet_', ''), 10), targetH3, armyName);
  } else if (sid.startsWith('char_')) {
    await processCharacterMovement(parseInt(sid.replace('char_', ''), 10), targetH3, armyName);
  } else {
    await processArmyMovement(armyId, targetH3, armyName);
  }
};

const processFleetMovement = async (fleetId, targetH3, fleetName) => {
  try {
    const response = await mapApi.moveFleet(fleetId, targetH3);
    if (response.success) {
      showToast(`✅ ${response.message || `${fleetName} en marcha hacia ${targetH3}`}`, 'success');
      if (response.data?.path && response.data?.from) {
        RouteVisualizer.drawPath(fleetId, response.data.path, response.data.from);
      }
      await fetchHexagonData();
    } else {
      showToast(`⚠️ ${response.message || 'No se pudo mover la flota'}`, 'warning');
    }
  } catch (error) {
    const msg = error.response?.data?.message || error.message || 'Error al mover la flota';
    showToast(`❌ ${msg}`, 'error');
  }
};

const processArmyMovement = async (armyId, targetH3, armyName) => {
  try {
    console.log(`[MapViewer] Procesando movimiento: Ejército ${armyId} → ${targetH3}`);

    // Llamar a API de movimiento
    const response = await mapApi.moveArmy(armyId, targetH3);

    if (response.success) {
      showToast(`✅ ${response.message || `${armyName} en marcha hacia ${targetH3}`}`, 'success');

      // Dibujar ruta inmediatamente (feedback visual instantáneo)
      if (response.data?.path && response.data?.from) {
        RouteVisualizer.drawPath(armyId, response.data.path, response.data.from);
      }

      // Refrescar datos del mapa (también redibujará rutas vía fetchAndDrawRoutes)
      await fetchHexagonData();
    } else {
      showToast(`⚠️ ${response.message || 'No se pudo mover el ejército'}`, 'warning');
    }

  } catch (error) {
    console.error('[MapViewer] Error procesando movimiento:', error);
    const errorMsg = error.response?.data?.message || error.message || 'Error al mover ejército';
    showToast(`❌ ${errorMsg}`, 'error');
  }
};

/**
 * Envía la orden de movimiento para todos los trabajadores propios en fromH3.
 * @param {string} fromH3 - Hex origen donde están los trabajadores
 * @param {string} targetH3 - Hex destino seleccionado por el jugador
 */
const processWorkerMovement = async (workerId, fromH3, targetH3) => {
  try {
    const parsedId = Number(workerId);
    if (!parsedId || !Number.isFinite(parsedId)) {
      console.error(`[MapViewer] workerId inválido: ${workerId}. Recarga la página e inténtalo de nuevo.`);
      showToast('Error: ID de trabajador no disponible. Recarga la página.', 'error');
      return;
    }
    console.log(`[MapViewer] Movimiento trabajador #${parsedId}: ${fromH3} → ${targetH3}`);
    const response = await mapApi.setWorkerHexDestination(parsedId, targetH3);

    if (response.success) {
      showToast(`✅ ${response.message || `Trabajadores en ruta hacia ${targetH3}`}`, 'success');
      RouteVisualizer.drawWorkerPath(parsedId, fromH3, targetH3);
      await fetchMyWorkers();
      await fetchHexagonData();
    } else {
      showToast(`⚠️ ${response.message || 'No se pudo mover los trabajadores'}`, 'warning');
    }
  } catch (error) {
    console.error('[MapViewer] Error procesando movimiento de trabajadores:', error);
    const errorMsg = error.response?.data?.message || error.message || 'Error al mover trabajadores';
    showToast(`❌ ${errorMsg}`, 'error');
  }
};

// ============================================
// KEYBOARD EVENT HANDLERS
// ============================================

/**
 * Maneja eventos de teclado (principalmente ESC para cerrar paneles/estados)
 * Implementa una lógica jerárquica de cierre - UNA acción por pulsación
 */
const handleKeyDown = (event) => {
  // Solo procesar la tecla ESC
  if (event.key !== 'Escape') return;

  console.log('[MapViewer] 🔑 ESC presionado - Verificando estados...');

  let actionTaken = false;

  // PRIORIDAD 1: Cancelar modo de selección de destino
  if (MapInteractionController.isInteracting()) {
    console.log('[MapViewer] ⭐ PRIORIDAD 1: Cancelando modo de selección');
    MapInteractionController.cancelSelection();

    // Resetear cursor a grab (cursor por defecto de Leaflet)
    if (map) {
      const container = map.getContainer();
      container.style.cursor = 'grab';
      console.log('[MapViewer] Cursor reseteado a grab');
    }

    showToast('Selección cancelada', 'info');
    actionTaken = true;
  }

  // PRIORIDAD 2: Cerrar CUALQUIER popup de Leaflet (feudos, tropas, etc.)
  // CRÍTICO: Verificar SIEMPRE si hay popups, incluso si ya se tomó otra acción
  if (!actionTaken) {
    // Método 1: Verificar DOM directamente (más confiable)
    const popupElements = document.querySelectorAll('.leaflet-popup');
    console.log(`[MapViewer] Popups en DOM: ${popupElements.length}`);

    // Método 2: Usar API de Leaflet si está disponible
    let isOpen = false;
    if (map && typeof map.isPopupOpen === 'function') {
      isOpen = map.isPopupOpen();
      console.log(`[MapViewer] Estado popup (isPopupOpen): ${isOpen}`);
    } else {
      console.log(`[MapViewer] map.isPopupOpen no disponible (map existe: ${!!map})`);
    }

    if (isOpen || popupElements.length > 0) {
      console.log('[MapViewer] ⭐ PRIORIDAD 2: Cerrando popup del mapa');

      // Intentar cerrar mediante Leaflet
      if (map && typeof map.closePopup === 'function') {
        map.closePopup();
      }

      // Fallback: Remover del DOM directamente
      popupElements.forEach(popup => {
        console.log('[MapViewer] Removiendo popup del DOM manualmente');
        popup.remove();
      });

      actionTaken = true;
    }
  }

  // PRIORIDAD 3: Cerrar paneles laterales/overlays (Reino, Mensajes, Tropas, Capas)
  if (!actionTaken && activeOverlay.value) {
    console.log(`[MapViewer] ⭐ PRIORIDAD 3: Cerrando overlay: ${activeOverlay.value}`);
    activeOverlay.value = null;
    actionTaken = true;
  }

  // PRIORIDAD 3b: Cerrar panel lateral activo (Economía, Mercado, Notificaciones, Perfil)
  if (!actionTaken && activePanel.value) {
    console.log(`[MapViewer] ⭐ PRIORIDAD 3b: Cerrando panel: ${activePanel.value}`);
    activePanel.value = null;
    // Devolver el foco al contenedor del mapa para que el usuario pueda interactuar
    map?.getContainer()?.focus();
    actionTaken = true;
  }

  // PRIORIDAD 4: Cerrar panel de novedades si está abierto
  if (!actionTaken && showChangelog.value) {
    console.log('[MapViewer] ⭐ PRIORIDAD 4: Cerrando panel de novedades');
    showChangelog.value = false;
    actionTaken = true;
  }

  // PRIORIDAD 5: Cerrar panel de usuario si está abierto
  if (!actionTaken && showUserPanel.value) {
    console.log('[MapViewer] ⭐ PRIORIDAD 5: Cerrando panel de usuario');
    showUserPanel.value = false;
    actionTaken = true;
  }

  if (actionTaken) {
    console.log('[MapViewer] ✅ Acción ejecutada, previniendo propagación');
    event.preventDefault();
    event.stopPropagation();
  } else {
    console.log('[MapViewer] ℹ️ ESC presionado pero no hay estados para cerrar');
  }
};

// Lifecycle hooks
onMounted(() => {
  if (!localStorage.getItem('staging_notice_seen')) {
    showStagingNotice.value = true;
    localStorage.setItem('staging_notice_seen', '1');
  }
  checkAuth(); // Check authentication first
  loadWorkerTypes(); // Load worker type catalog for popup hire form
  initMap();
  fetchTerrainTypes();
  fetchWorldState();
  loadExplorationConfig(); // Load exploration configuration
  updateFiefsUI(); // Load initial fiefs list
  fetchArmyCapacity(); // Load army limit based on fief count
  loadMessages(); // Load initial messages
  startSync(); // Start server synchronization (polls every 30 seconds)
  startNotifPolling(); // Start background notification polling (every 45 seconds)
  fetchDivisionBoundaries(); // Load political division borders
  fetchMyWorkers();          // Draw worker movement routes on startup
  // Pre-fetch capital so the "Fundar Capital" button condition is reliable from the first click
  mapApi.getCapital().then(r => {
    if (r?.success) { capitalH3Index.value = r.h3_index; isExiled.value = r.is_exiled ?? false; }
  }).catch(() => {});

  // Setup Map Interaction Controller
  setupMapInteractionController();

  // Setup keyboard event listeners
  window.addEventListener('keydown', handleKeyDown);
  console.log('[MapViewer] ✓ Keyboard event listeners registered');
});

onBeforeUnmount(() => {
  // Clear keyboard event listeners
  window.removeEventListener('keydown', handleKeyDown);
  console.log('[MapViewer] ✓ Keyboard event listeners removed');

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  stopSync(); // Stop server synchronization
  stopNotifPolling(); // Stop background notification polling
  if (map) {
    map.remove();
  }
});
</script>

<style scoped>
/* ============================================
   MEDIEVAL VISUAL LANGUAGE - COLOR PALETTE
   ============================================ */
:root {
  --color-bg-dark: #1a1612;        /* Negro carbón (fondo menús) */
  --color-accent-gold: #c5a059;    /* Dorado envejecido (acentos) */
  --color-text-cream: #e8d5b5;     /* Hueso/Crema (textos) */
  --color-text-dim: #a89875;       /* Texto secundario */
  --color-border: #3d3428;         /* Bordes sutiles */
  --color-hover: #d4b06a;          /* Hover dorado */

  --font-serif: 'Cinzel', 'Georgia', serif;
  --font-sans: 'Inter', 'Segoe UI', sans-serif;
}

/* Scrollbar Styling */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 5px;
}

::-webkit-scrollbar-thumb {
  background: rgba(197, 160, 89, 0.5);
  border-radius: 5px;
  border: 2px solid rgba(0, 0, 0, 0.3);
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(197, 160, 89, 0.7);
}

* {
  scrollbar-width: thin;
  scrollbar-color: rgba(197, 160, 89, 0.5) rgba(0, 0, 0, 0.3);
}

/* Parchment/Manuscript Texture */
.parchment-style {
  background-color: var(--color-bg-dark);
  background-image:
    url("data:image/svg+xml,%3Csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' /%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23noise)' opacity='0.05'/%3E%3C/svg%3E");
  border: 2px solid var(--color-accent-gold);
  box-shadow:
    inset 0 0 20px rgba(0, 0, 0, 0.6),
    0 0 15px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(197, 160, 89, 0.2);
  color: var(--color-text-cream);
}

.parchment-border {
  border: 2px solid var(--color-accent-gold);
  border-image: repeating-linear-gradient(
    45deg,
    var(--color-accent-gold),
    var(--color-accent-gold) 10px,
    transparent 10px,
    transparent 20px
  ) 1;
  position: relative;
}

.parchment-border::before {
  content: '';
  position: absolute;
  top: -4px;
  left: -4px;
  right: -4px;
  bottom: -4px;
  border: 1px solid rgba(197, 160, 89, 0.3);
  pointer-events: none;
  border-radius: inherit;
}

.app-container {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: #0d0b09;
}

/* Full Background Map */
.map-background {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
}

/* 1. SIDEBAR IZQUIERDO: Asegurar que no se corte y tenga contraste */
#main-sidebar,
.main-sidebar {
  position: fixed;
  left: 0;
  top: 0;
  width: 300px; /* Ancho amplio para legibilidad */
  height: 100vh; /* Ocupa todo el alto */
  background: #110f0d; /* Fondo oscuro medieval */
  background-image:
    url("data:image/svg+xml,%3Csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' /%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23noise)' opacity='0.05'/%3E%3C/svg%3E");
  border-right: 3px solid #c5a059; /* Borde dorado */
  z-index: 1000;
  display: flex;
  flex-direction: column;
  color: #e8d5b5; /* Letras color hueso (Alto contraste) */
  box-shadow: 10px 0 30px rgba(0, 0, 0, 0.9);
}

/* Sidebar Header */
.sidebar-header {
  padding: 25px 20px;
  border-bottom: 2px solid #c5a059;
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: linear-gradient(135deg, rgba(26, 22, 18, 0.95) 0%, rgba(13, 11, 9, 0.95) 100%);
  box-shadow:
    inset 0 -1px 0 rgba(197, 160, 89, 0.3),
    0 2px 10px rgba(0, 0, 0, 0.5);
}

.header-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  border: 2px solid var(--color-accent-gold);
}

.stat-icon {
  font-size: 24px;
  filter: sepia(1) saturate(2) hue-rotate(5deg);
}

.stat-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.stat-value {
  font-size: 28px;
  font-weight: bold;
  color: #c5a059;
  font-family: 'Inter', sans-serif;
  text-shadow: 0 0 10px rgba(197, 160, 89, 0.4);
}

.stat-label {
  font-size: 11px;
  color: #a89875;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-family: 'Cinzel', serif;
}

.header-date {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  font-size: 11px;
}

.date-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-cream);
}

.date-icon {
  font-size: 14px;
  filter: sepia(1) saturate(2) hue-rotate(5deg);
}

.date-value,
.date-label {
  font-size: 11px;
  font-family: var(--font-sans);
  color: var(--color-text-cream);
}

.harvest-row {
  border-top: 1px solid var(--color-border);
  padding-top: 8px;
  margin-top: 6px;
}

/* Sidebar harvest text - specific selector to override banner style */
.header-date .harvest-text {
  font-size: 0.9rem;
  font-family: 'Quattrocento', serif;
  color: #c5a059;
  line-height: 1.3;
  text-shadow: none;
  font-weight: normal;
}

/* Sidebar Navigation */
.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-button {
  position: relative;
  display: flex;
  flex-direction: row; /* Horizontal con el nuevo ancho */
  align-items: center;
  justify-content: flex-start;
  gap: 15px;
  padding: 18px 20px;
  background: transparent;
  border: none;
  border-left: 3px solid transparent;
  color: #e8d5b5;
  cursor: pointer;
  transition: all 0.3s ease;
  font-family: 'Cinzel', serif;
  width: 100%;
}

.nav-button:hover {
  background: rgba(197, 160, 89, 0.15);
  border-left-color: #c5a059;
  color: #c5a059;
  padding-left: 25px;
}

.nav-button.active {
  background: rgba(197, 160, 89, 0.2);
  border-left-color: #c5a059;
  color: #c5a059;
}

.nav-icon {
  font-size: 24px;
  filter: sepia(1) saturate(1.5) hue-rotate(5deg);
  transition: filter 0.3s ease;
  flex-shrink: 0;
}

.nav-button:hover .nav-icon,
.nav-button.active .nav-icon {
  filter: sepia(1) saturate(2) hue-rotate(10deg) drop-shadow(0 0 8px rgba(197, 160, 89, 0.6));
}

.nav-label {
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 1px;
  text-align: left;
  line-height: 1.2;
  font-weight: 600;
}

.nav-badge {
  position: absolute;
  top: 8px;
  right: 12px;
  background: #e74c3c;
  color: white;
  font-size: 10px;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 10px;
  box-shadow: 0 2px 6px rgba(231, 76, 60, 0.5);
}

/* Sidebar Footer */
.legal-links {
  display: flex;
  justify-content: center;
  gap: 4px;
  padding: 6px 8px 4px;
  flex-wrap: wrap;
}

.legal-links a {
  font-size: 0.6rem;
  color: #3a2e20;
  text-decoration: none;
  letter-spacing: 0.3px;
  transition: color 0.2s;
  font-family: var(--font-sans);
}

.legal-links a:hover { color: #6a5a40; }

.legal-sep {
  font-size: 0.6rem;
  color: #2a2015;
}

.sidebar-footer {
  padding: 12px 12px 4px;
  border-top: 2px solid var(--color-accent-gold);
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: linear-gradient(135deg, rgba(13, 11, 9, 0.95) 0%, rgba(26, 22, 18, 0.95) 100%);
  box-shadow:
    inset 0 1px 0 rgba(197, 160, 89, 0.3),
    0 -2px 10px rgba(0, 0, 0, 0.5);
}

.footer-actions {
  display: flex;
  flex-direction: row;
  gap: 6px;
}

.user-info-footer {
  font-size: 10px;
  color: var(--color-text-dim);
  text-align: center;
  padding: 4px 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
  width: 100%;
}

.user-info-footer:hover,
.user-info-footer.active {
  border-color: rgba(197, 160, 89, 0.4);
  color: var(--color-accent-gold);
}

.username {
  font-family: var(--font-sans);
  font-size: 0.75rem;
}

.culture-badge {
  display: block;
  font-size: 0.68rem;
  font-family: var(--font-sans);
  color: var(--gold-light, #c5a059);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.85;
  margin-top: 1px;
}

/* Profile panel */
.profile-panel {
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.profile-info {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(197, 160, 89, 0.2);
  border-radius: 6px;
  padding: 12px 14px;
}

.profile-field-label {
  font-size: 0.72rem;
  color: #a89875;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 4px;
}

.profile-username {
  font-size: 0.95rem;
  color: #e8d5b5;
  font-family: monospace;
}

.profile-edit-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.profile-input {
  width: 100%;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(197, 160, 89, 0.3);
  border-radius: 6px;
  color: #e8d5b5;
  font-size: 0.95rem;
  font-family: var(--font-sans);
  transition: border-color 0.2s;
}

.profile-input:focus {
  outline: none;
  border-color: rgba(197, 160, 89, 0.7);
}

.profile-input--readonly {
  opacity: 0.6;
  cursor: default;
  border-color: rgba(197, 160, 89, 0.15);
}

.profile-hint {
  font-size: 0.75rem;
  color: #a89875;
  line-height: 1.4;
}

.profile-save-button {
  padding: 10px 14px;
  background: rgba(197, 160, 89, 0.15);
  border: 1px solid rgba(197, 160, 89, 0.5);
  border-radius: 6px;
  color: #ffd700;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.profile-save-button:hover:not(:disabled) {
  background: rgba(197, 160, 89, 0.28);
  border-color: rgba(197, 160, 89, 0.8);
}

.profile-save-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.footer-button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 10px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-cream);
  cursor: pointer;
  transition: all 0.3s ease;
  text-decoration: none;
}

.footer-button:hover {
  background: rgba(197, 160, 89, 0.2);
  border-color: var(--color-accent-gold);
  transform: translateY(-2px);
}

.footer-icon {
  font-size: 20px;
  filter: sepia(1) saturate(1.5) hue-rotate(5deg);
}

.logout-button:hover {
  background: rgba(231, 76, 60, 0.2);
  border-color: #e74c3c;
}

/* 2. SUBMENÚ: Gran tamaño y estilo pergamino oscuro */
#submenu-panel,
#context-panel,
.context-panel {
  position: fixed;
  left: 300px; /* Justo después del sidebar de 300px */
  top: 0;
  width: calc(50vw - 300px); /* Ocupa la mitad del espacio restante */
  height: 100vh;
  background: #1c1814; /* Marrón oscuro (estilo pergamino viejo) */
  background-image:
    url("data:image/svg+xml,%3Csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' /%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23noise)' opacity='0.05'/%3E%3C/svg%3E");
  border-right: 2px solid #4d3d2b;
  box-shadow: 10px 0 20px rgba(0, 0, 0, 0.5);
  z-index: 999;
  padding: 30px;
  color: #e8d5b5; /* Texto crema legible */
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  transform: translateX(-100%);
  transition: transform 0.3s ease;
}

.context-panel.open {
  transform: translateX(0);
}

.panel-header {
  padding: 20px;
  margin: -20px -20px 20px -20px; /* Extiende hasta los bordes */
  border-bottom: 2px solid #c5a059;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(135deg, #1a1612 0%, #0d0b09 100%);
  box-shadow:
    inset 0 -1px 0 rgba(197, 160, 89, 0.3),
    0 2px 10px rgba(0, 0, 0, 0.5);
}

.panel-title {
  margin: 0;
  font-size: 20px;
  color: #f2e6d0; /* Texto crema brillante */
  font-family: var(--font-serif);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  text-shadow:
    0 0 15px rgba(197, 160, 89, 0.6),
    0 2px 3px rgba(0, 0, 0, 0.9);
  font-weight: bold;
}

.panel-close {
  background: transparent;
  border: 2px solid var(--color-border);
  color: var(--color-text-cream);
  font-size: 18px;
  font-weight: bold;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel-close:hover {
  background: rgba(231, 76, 60, 0.2);
  border-color: #e74c3c;
  color: #e74c3c;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0; /* Sin padding extra, el context-panel ya tiene padding */
}

.panel-section {
  padding: 0; /* Sin padding extra */
}

.panel-placeholder {
  color: var(--color-text-dim);
  font-style: italic;
  text-align: center;
  padding: 40px 20px;
}

/* ── Market Panel ── */
.market-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  overflow-y: auto;
}

.market-section {
  padding: 12px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.market-section-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: #c5a059;
  display: flex;
  align-items: center;
  gap: 6px;
}

.market-worker-count {
  background: rgba(197,160,89,0.2);
  color: #c5a059;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
}

.market-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.market-hire-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.market-worker-type-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.market-worker-type-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 12px;
  background: rgba(0,0,0,0.35);
  border: 1px solid rgba(197,160,89,0.35);
  border-radius: 6px;
  color: #e8d5b5;
  cursor: pointer;
  flex: 1;
  min-width: 80px;
  transition: background 0.15s, border-color 0.15s;
}
.market-worker-type-btn:hover {
  background: rgba(197,160,89,0.15);
  border-color: rgba(197,160,89,0.6);
}
.market-worker-type-btn.active {
  background: rgba(197,160,89,0.25);
  border-color: #c5a059;
}
.worker-type-icon  { font-size: 20px; }
.worker-type-name  { font-size: 11px; text-transform: capitalize; }
.worker-type-cost  { font-size: 10px; color: #9ca3af; }

.market-select {
  width: 100%;
  padding: 5px 8px;
  background: rgba(0,0,0,0.35);
  border: 1px solid rgba(197,160,89,0.35);
  border-radius: 4px;
  color: #e8d5b5;
  font-size: 12px;
  cursor: pointer;
}
.market-select:focus { outline: none; border-color: #c5a059; }

.market-hint {
  font-size: 10px;
  color: var(--color-text-dim);
  margin: 0;
}

.market-food-price-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.market-price-label {
  font-size: 11px;
  color: var(--color-text-dim);
}

.market-price-value {
  font-size: 12px;
  font-weight: 600;
  color: #fbbf24;
}

.market-food-form {
  display: flex;
  align-items: center;
  gap: 8px;
}

.market-qty-input {
  flex: 1;
  padding: 5px 8px;
  background: rgba(0,0,0,0.35);
  border: 1px solid rgba(197,160,89,0.35);
  border-radius: 4px;
  color: #e8d5b5;
  font-size: 12px;
  min-width: 0;
}
.market-qty-input:focus { outline: none; border-color: #c5a059; }

.market-food-total {
  font-size: 11px;
  color: #fbbf24;
  white-space: nowrap;
}

.market-food-actions {
  display: flex;
  gap: 6px;
}

.market-btn {
  flex: 1;
  padding: 6px 8px;
  border: none;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s;
}
.market-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.market-btn:not(:disabled):hover { opacity: 0.85; }

.market-btn-hire {
  background: #b45309;
  color: #fef3c7;
}
.market-btn-hire:disabled { background: #374151; color: #6b7280; }

.market-btn-buy {
  background: #16a34a;
  color: #f0fdf4;
}

.market-btn-sell {
  background: #b45309;
  color: #fef3c7;
}

.btn-refresh-workers {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0.7;
}
.btn-refresh-workers:hover { opacity: 1; }

.workers-loading,
.workers-empty {
  text-align: center;
  color: var(--color-text-dim);
  font-size: 12px;
  padding: 20px 8px;
}
.workers-hint {
  margin-top: 6px;
  font-size: 11px;
}

.workers-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  max-height: calc(100vh - 200px);
}

.worker-card {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.worker-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.worker-type-badge {
  font-size: 12px;
  font-weight: 600;
  color: #f59e0b;
}

.worker-id {
  font-size: 10px;
  color: var(--color-text-dim);
}

.worker-card-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--color-text-dim);
}

.worker-en-route {
  color: #34d399;
  font-size: 11px;
}

.worker-card-stats {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: var(--color-text-dim);
}

.worker-card-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.worker-btn {
  flex: 1;
  padding: 4px 6px;
  border: none;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.worker-btn:hover:not(:disabled) { opacity: 0.85; }

.worker-btn-build {
  background: #374151;
  color: #9ca3af;
  border: 1px solid #4b5563;
  cursor: not-allowed;
}

.worker-btn-build-active {
  background: #22c55e;
  color: #14532d;
}

.worker-btn-move {
  background: #f59e0b;
  color: #1c1917;
}

.worker-terrain {
  font-size: 10px;
  color: #60a5fa;
}

/* Layers Panel Sections */
.layers-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.legend-section,
.visibility-section,
.transparency-section,
.map-info-section,
.navigation-section {
  padding: 16px;
  margin-bottom: 20px;
  background-color: rgba(0, 0, 0, 0.4);
  background-image:
    url("data:image/svg+xml,%3Csvg width='50' height='50' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='3' /%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='50' height='50' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
  border-radius: 6px;
  border: 1px solid #4d3d2b;
  box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5);
}

.section-title {
  font-size: 15px;
  color: #f2e6d0; /* Texto crema brillante */
  font-family: var(--font-serif);
  text-transform: uppercase;
  letter-spacing: 1.2px;
  margin: 0 0 12px 0;
  border-bottom: 1px solid #4d3d2b;
  padding-bottom: 8px;
  font-weight: 600;
  text-shadow:
    0 0 10px rgba(197, 160, 89, 0.4),
    0 1px 2px rgba(0, 0, 0, 0.8);
}

.section-loading {
  font-size: 12px;
  color: var(--color-text-dim);
  text-align: center;
  padding: 10px;
  font-style: italic;
}

/* Legend Items */
.legend-items {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  transition: all 0.3s ease;
}

.legend-item:hover {
  background: rgba(197, 160, 89, 0.1);
}

.legend-color-circle {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid var(--color-accent-gold);
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(197, 160, 89, 0.4);
}

.legend-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.legend-name {
  font-size: 13px;
  color: var(--color-text-cream);
  font-family: 'Inter', sans-serif;
  font-weight: 600;
}

.legend-capacity {
  font-size: 11px;
  color: var(--color-text-dim);
  font-family: 'Inter', sans-serif;
}

/* Toggle Controls */
.toggle-container {
  margin-bottom: 12px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  position: relative;
  padding: 10px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  transition: all 0.3s ease;
}

.toggle-label:hover {
  background: rgba(197, 160, 89, 0.1);
}

.toggle-checkbox {
  position: absolute;
  opacity: 0;
  cursor: pointer;
  height: 0;
  width: 0;
}

.toggle-slider {
  width: 44px;
  height: 24px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 24px;
  position: relative;
  transition: background 0.3s ease;
  border: 2px solid var(--color-border);
  flex-shrink: 0;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  height: 16px;
  width: 16px;
  left: 2px;
  top: 2px;
  background: var(--color-text-dim);
  border-radius: 50%;
  transition: all 0.3s ease;
}

.toggle-checkbox:checked ~ .toggle-slider {
  background: var(--color-accent-gold);
  border-color: var(--color-accent-gold);
}

.toggle-checkbox:checked ~ .toggle-slider::before {
  transform: translateX(20px);
  background: var(--color-bg-dark);
}

.toggle-text {
  font-size: 13px;
  color: #f2e6d0; /* Texto crema brillante */
  font-family: var(--font-sans);
}

/* Transparency Slider */
.slider-container {
  display: flex;
  align-items: center;
  gap: 12px;
}

.opacity-slider {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.4);
  outline: none;
  -webkit-appearance: none;
  border: 1px solid var(--color-border);
}

.opacity-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-accent-gold);
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(197, 160, 89, 0.5);
  transition: all 0.2s ease;
}

.opacity-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 3px 8px rgba(197, 160, 89, 0.7);
}

.opacity-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-accent-gold);
  cursor: pointer;
  border: none;
  box-shadow: 0 2px 6px rgba(197, 160, 89, 0.5);
  transition: all 0.2s ease;
}

.opacity-slider::-moz-range-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 3px 8px rgba(197, 160, 89, 0.7);
}

.slider-label {
  font-size: 12px;
  color: var(--color-text-dim);
  font-weight: 600;
  min-width: 70px;
}

.opacity-value {
  font-size: 13px;
  font-weight: bold;
  color: var(--color-accent-gold);
  font-family: 'Inter', sans-serif;
  min-width: 40px;
  text-align: right;
}

/* Telemetry Section */
.telemetry-section {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 12px;
}

.telemetry-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.telemetry-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  border-left: 3px solid var(--color-accent-gold);
}

.telemetry-label {
  font-size: 11px;
  color: var(--color-text-dim);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.telemetry-value {
  font-size: 13px;
  color: var(--color-accent-gold);
  font-weight: bold;
  font-family: 'Inter', sans-serif;
}

.telemetry-h3 {
  font-size: 10px;
  font-family: 'Courier New', monospace;
  color: var(--color-text-cream);
  background: rgba(0, 0, 0, 0.4);
  padding: 2px 6px;
  border-radius: 3px;
}

/* Map Info Section */
.map-info-section p {
  font-size: 12px;
  color: var(--color-text-cream);
  margin: 6px 0;
  font-family: var(--font-sans);
}

.map-info-section strong {
  color: var(--color-accent-gold);
}

/* Navigation Section */
.search-container {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.search-input {
  flex: 1;
  padding: 10px;
  background: rgba(0, 0, 0, 0.4);
  border: 2px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-cream);
  font-size: 13px;
  font-family: var(--font-sans);
  transition: all 0.3s ease;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-accent-gold);
  box-shadow: 0 0 8px rgba(197, 160, 89, 0.3);
}

.search-button {
  padding: 10px 14px;
  background: var(--color-accent-gold);
  border: none;
  border-radius: 4px;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(197, 160, 89, 0.4);
}

.search-button:hover {
  background: var(--color-hover);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(197, 160, 89, 0.6);
}

.capital-button {
  width: 100%;
  padding: 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 2px solid var(--color-accent-gold);
  border-radius: 4px;
  color: var(--color-accent-gold);
  font-size: 13px;
  font-family: var(--font-serif);
  cursor: pointer;
  transition: all 0.3s ease;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.capital-button:hover {
  background: rgba(197, 160, 89, 0.2);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(197, 160, 89, 0.3);
}

/* Kingdom Panel - Fiefs List */
.kingdom-panel {
  padding: 0;
}

.kingdom-panel .fiefs-list {
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  padding: 16px;
}

.fiefs-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text-dim);
  font-style: italic;
  font-size: 13px;
}

.fief-card {
  background-color: rgba(0, 0, 0, 0.4);
  background-image:
    url("data:image/svg+xml,%3Csvg width='50' height='50' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='3' /%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='50' height='50' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
  border: 1px solid #4d3d2b;
  border-radius: 6px;
  padding: 14px;
  margin-bottom: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5);
}

.fief-card:hover {
  background: rgba(197, 160, 89, 0.15);
  border-color: var(--color-accent-gold);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(197, 160, 89, 0.3);
}

.fief-card.fief-low-food {
  border-color: #e74c3c;
  box-shadow: 0 0 8px rgba(231, 76, 60, 0.2);
}

.fief-name {
  font-size: 15px;
  font-weight: bold;
  color: #f2e6d0; /* Texto crema brillante */
  margin-bottom: 6px;
  font-family: var(--font-serif);
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}

.fief-terrain {
  font-size: 11px;
  color: var(--color-text-dim);
  margin-bottom: 10px;
  font-family: var(--font-sans);
}

.fief-stats {
  display: flex;
  gap: 16px;
}

.fief-stat {
  display: flex;
  align-items: center;
  gap: 6px;
}

.fief-icon {
  font-size: 16px;
  filter: sepia(1) saturate(1.5) hue-rotate(5deg);
}

.fief-value {
  font-size: 14px;
  font-weight: bold;
  color: #f2e6d0; /* Texto crema brillante */
  font-family: var(--font-sans);
}

.fief-food {
  color: var(--color-accent-gold);
}

.fief-autonomy {
  color: #a0c4a0;
}

.fief-autonomy--ok {
  color: #6fcf97;
}

.fief-autonomy--low {
  color: #e74c3c;
}

.loading-more {
  text-align: center;
  padding: 20px;
  color: var(--color-text-dim);
  font-style: italic;
  font-size: 12px;
}

/* Kingdom Management Panel */
.kingdom-management-panel {
  display: flex;
  flex-direction: column;
  gap: 0; /* Remove gap to allow sticky header to sit flush */
  padding: 0;
  height: calc(100vh - 100px);
  position: relative;
}

.kingdom-controls {
  position: sticky;
  top: 0;
  background: var(--color-bg-dark);
  z-index: 20;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-bottom: 2px solid var(--color-accent-gold);
  box-shadow: 0 4px 10px rgba(0,0,0,0.5);
}

.kingdom-actions {
  display: flex;
  gap: 12px;
}

.kingdom-action-btn {
  flex: 1;
  padding: 12px 20px;
  background: rgba(197, 160, 89, 0.15);
  border: 2px solid var(--color-accent-gold);
  border-radius: 4px;
  color: var(--color-accent-gold);
  font-family: 'Cinzel', serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.kingdom-content {
  display: flex !important;
  flex-direction: row !important;
  padding: 0 !important;
  overflow: hidden !important;
  height: calc(100% - 70px) !important;
}

.kingdom-sidebar {
  width: 250px;
  background: rgba(0, 0, 0, 0.4);
  border-right: 2px solid var(--color-accent-gold);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  overflow-y: auto;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sidebar-subtitle {
  font-family: var(--font-serif);
  color: var(--color-accent-gold);
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 1px;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 5px;
}

.kingdom-actions-vertical {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.kingdom-action-btn-sidebar {
  width: 100%;
  padding: 12px;
  background: rgba(197, 160, 89, 0.1);
  border: 1px solid var(--color-accent-gold);
  border-radius: 4px;
  color: var(--color-accent-gold);
  font-family: 'Cinzel', serif;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.3s ease;
  text-align: left;
}

.kingdom-action-btn-sidebar:hover {
  background: rgba(197, 160, 89, 0.2);
  transform: translateX(5px);
}

.kingdom-filters-vertical {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.filter-group label {
  font-size: 12px;
  color: var(--color-text-dim);
}

.kingdom-filter-input-sidebar {
  padding: 10px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-cream);
  font-size: 13px;
}

.kingdom-filter-input-sidebar:focus {
  border-color: var(--color-accent-gold);
  outline: none;
}

.kingdom-summary p {
  font-size: 13px;
  margin: 5px 0;
  color: var(--color-text-cream);
}

.kingdom-table-wrapper {
  flex: 1;
  overflow-y: auto;
  padding: 0;
  position: relative;
}

.kingdom-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px; /* Slightly smaller for density */
}

.kingdom-table thead th {
  position: sticky;
  top: 0;
  background: #1a1612;
  z-index: 10;
  padding: 12px 6px;
  border-bottom: 2px solid var(--color-accent-gold);
  font-family: 'Cinzel', serif;
  font-size: 10px; /* Smaller for better fit */
  color: var(--color-accent-gold);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  transition: background 0.2s ease;
  vertical-align: middle;
}

.kingdom-table th.th-abbr {
  border-bottom: 1px dotted rgba(232, 213, 181, 0.5);
  cursor: help;
}

.kingdom-table th:hover {
  background: rgba(197, 160, 89, 0.15);
}

.kingdom-row {
  cursor: pointer;
  transition: all 0.2s ease;
  border-bottom: 1px solid rgba(77, 61, 43, 0.3);
}

.kingdom-row:hover {
  background: rgba(197, 160, 89, 0.1);
}

.kingdom-row td {
  padding: 10px 6px;
  font-size: 12px;
  color: var(--color-text-cream);
  border-bottom: 1px solid rgba(197, 160, 89, 0.1);
  white-space: nowrap;
}

/* Scrollbar specifically for the table wrapper */
.kingdom-table-wrapper::-webkit-scrollbar {
  width: 12px;
}

.kingdom-table-wrapper::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
}

.kingdom-table-wrapper::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #c5a059 0%, #8B6914 100%);
  border-radius: 6px;
  border: 2px solid #1a1612;
}

.kingdom-table-wrapper::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, #d4b06a 0%, #c5a059 100%);
}

.kingdom-cell-name {
  font-weight: 600;
  color: var(--color-accent-gold);
}

.alert-low {
  color: #ff4444 !important;
  font-weight: bold;
}

.alert-high {
  color: #50c878 !important;
  font-weight: bold;
}

/* Exploration Status Badges */
.exploration-badge {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-right: 5px;
}

.exploration-badge-pending {
  background: rgba(128, 128, 128, 0.2);
  color: #999;
  border: 1px solid #666;
}

.exploration-badge-exploring {
  background: rgba(255, 191, 0, 0.2);
  color: #d4a017;
  border: 1px solid #d4a017;
  animation: pulse 2s infinite;
}

.exploration-badge-completed {
  background: rgba(46, 204, 113, 0.2);
  color: #27ae60;
  border: 1px solid #27ae60;
}

/* Mining Status Badges */
.mining-status-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  margin-left: 5px;
  font-weight: 600;
}

.mining-low {
  background: rgba(212, 160, 23, 0.2);
  color: #d4a017;
  border: 1px solid #d4a017;
}

.btn-explore-micro {
  background: linear-gradient(135deg, #6b4423 0%, #8b5a2b 100%) !important;
  border-color: #8b5a2b !important;
  color: white !important;
  padding: 4px 8px !important;
  font-size: 12px !important;
  margin-left: 5px;
}

.btn-explore-micro:hover:not(:disabled) {
  filter: brightness(1.2);
}

.btn-explore-micro:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.kingdom-empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--color-text-dim);
  font-style: italic;
  font-size: 13px;
}

/* Messages Panel - Split View */
.messages-panel-container {
  padding: 0;
  height: calc(100vh - 80px);
}

.messages-split {
  display: flex;
  height: 100%;
}

.messages-list-column {
  width: 45%;
  border-right: 2px solid var(--color-border);
  overflow-y: auto;
  padding: 12px;
}

.messages-viewer-column {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: rgba(0, 0, 0, 0.2);
}

.messages-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text-dim);
  font-style: italic;
  font-size: 13px;
}

.message-card {
  background-color: rgba(0, 0, 0, 0.4);
  background-image:
    url("data:image/svg+xml,%3Csvg width='50' height='50' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='3' /%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='50' height='50' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
  border: 1px solid #4d3d2b;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5);
}

.message-card:hover {
  background: rgba(197, 160, 89, 0.1);
  border-color: var(--color-accent-gold);
}

.message-card.message-unread {
  border-left: 4px solid var(--color-accent-gold);
  background: rgba(197, 160, 89, 0.05);
}

.message-card.message-selected {
  background: rgba(197, 160, 89, 0.2);
  border-color: var(--color-accent-gold);
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.message-sender {
  font-size: 12px;
  font-weight: bold;
  color: var(--color-accent-gold);
  font-family: var(--font-sans);
}

.message-date {
  font-size: 10px;
  color: var(--color-text-dim);
  font-family: var(--font-sans);
}

.message-subject {
  font-size: 14px;
  font-weight: bold;
  color: #f2e6d0; /* Texto crema brillante */
  margin-bottom: 4px;
  font-family: var(--font-serif);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}

.message-preview {
  font-size: 11px;
  color: var(--color-text-dim);
  font-family: var(--font-sans);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.no-message-selected {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-dim);
  font-style: italic;
  text-align: center;
  padding: 40px;
}

.message-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message-detail-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--color-border);
}

.message-detail-sender {
  font-size: 12px;
  font-weight: bold;
  color: var(--color-accent-gold);
  font-family: var(--font-sans);
}

.message-detail-date {
  font-size: 11px;
  color: var(--color-text-dim);
  font-family: var(--font-sans);
}

.message-detail-subject {
  font-size: 17px;
  font-weight: bold;
  color: #f2e6d0; /* Texto crema brillante */
  margin: 0;
  font-family: var(--font-serif);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}

.message-detail-content {
  font-size: 13px;
  color: var(--color-text-cream);
  line-height: 1.6;
  font-family: var(--font-sans);
  white-space: pre-wrap;
  padding: 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  border: 1px solid var(--color-border);
}

.message-map-button {
  padding: 12px 20px;
  background: var(--color-accent-gold);
  border: none;
  border-radius: 4px;
  color: var(--color-bg-dark);
  font-size: 13px;
  font-family: var(--font-serif);
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  box-shadow: 0 2px 8px rgba(197, 160, 89, 0.4);
}

.message-map-button:hover {
  background: var(--color-hover);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(197, 160, 89, 0.6);
}

.old-legend-items {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px;
  border-radius: 4px;
  transition: background 0.2s;
}

.legend-item:hover {
  background: #f9f9f9;
}

.legend-color {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 2px solid #333;
  flex-shrink: 0;
}

.legend-name {
  font-size: 14px;
  line-height: 1.3;
  color: #555;
}

/* Transparency Control */
.transparency-control {
  background: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.transparency-control h4 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: bold;
  color: #333;
}

.slider-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.transparency-control input[type='range'] {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: #ddd;
  outline: none;
  -webkit-appearance: none;
}

.transparency-control input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #3498db;
  cursor: pointer;
}

.transparency-control input[type='range']::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #3498db;
  cursor: pointer;
  border: none;
}

.opacity-value {
  font-size: 14px;
  font-weight: bold;
  color: #3498db;
  text-align: center;
}

/* H3 Layer Toggle Control */
.h3-toggle-control {
  background: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.h3-toggle-control h4 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: bold;
  color: #333;
}

.toggle-container {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.toggle-container:last-child {
  margin-bottom: 0;
}

.toggle-label {
  display: flex;
  align-items: center;
  cursor: pointer;
  position: relative;
  user-select: none;
}

.toggle-checkbox {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 26px;
  background-color: #ccc;
  border-radius: 26px;
  transition: background-color 0.3s;
  margin-right: 12px;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;
  left: 3px;
  top: 3px;
  background-color: white;
  border-radius: 50%;
  transition: transform 0.3s;
}

.toggle-checkbox:checked + .toggle-slider {
  background-color: #3498db;
}

.toggle-checkbox:checked + .toggle-slider::before {
  transform: translateX(24px);
}

.toggle-text {
  font-size: 14px;
  color: #555;
  font-weight: 500;
}

/* Map Info */
.map-info {
  background: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.map-info h4 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: bold;
  color: #333;
}

.map-info p {
  margin: 8px 0;
  font-size: 14px;
  color: #555;
}

.map-info .warning {
  color: #f44336;
  font-weight: bold;
  margin-top: 10px;
}

/* Navigation Control */
.navigation-control {
  background: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  margin-top: 15px;
}

.navigation-control h4 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: bold;
  color: #333;
}

.search-container {
  display: flex;
  gap: 4px;
  margin-bottom: 6px;
}

.search-input {
  flex: 1;
  padding: 4px 8px;
  height: 26px;
  border: 1px solid #ddd;
  border-radius: 3px;
  font-size: 12px;
  font-family: monospace;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.search-input:focus {
  outline: none;
  border-color: #4CAF50;
}

.search-input::placeholder {
  font-size: 11px;
  color: #999;
}

.search-button {
  padding: 4px 10px;
  height: 26px;
  background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
  border: none;
  border-radius: 3px;
  color: white;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.search-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.search-button:active {
  transform: translateY(0);
}

.capital-link {
  width: 100%;
  padding: 6px 12px;
  height: 30px;
  background: linear-gradient(135deg, #FFD700 0%, #FFC107 100%);
  border: 2px solid #FF8F00;
  border-radius: 3px;
  color: #5D4E37;
  font-size: 12px;
  font-weight: bold;
  font-family: 'Cinzel', 'Georgia', serif;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}

.capital-link:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(255, 215, 0, 0.4);
  background: linear-gradient(135deg, #FFE44D 0%, #FFD54F 100%);
}

.capital-link:active {
  transform: translateY(0);
}

/* Map Container */
/* Map Background */
#map {
  width: 100%;
  height: 100%;
}

/* Filtro "war room": fondo oscuro tipo pergamino quemado, hexágonos brillan sobre él */
#map :deep(.leaflet-layer) {
  filter: sepia(0.5) brightness(0.7) contrast(1.2) saturate(0.8);
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(26, 22, 18, 0.95);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 10;
}

.loading-overlay p {
  color: var(--color-text-cream);
  margin-top: 20px;
  font-family: var(--font-serif);
  font-size: 16px;
}

.spinner {
  border: 4px solid rgba(197, 160, 89, 0.2);
  border-top: 4px solid var(--color-accent-gold);
  border-radius: 50%;
  width: 50px;
  height: 50px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.error-message {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(231, 76, 60, 0.95);
  color: white;
  padding: 16px 28px;
  border-radius: 6px;
  z-index: 20;
  box-shadow: 0 4px 16px rgba(231, 76, 60, 0.4);
  border: 2px solid #e74c3c;
  font-family: var(--font-sans);
}

/* Building Markers - Game Buildings (Farms, Castles, Mines, etc.) */
:deep(.building-marker) {
  background: transparent;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.building-icon-emoji) {
  font-size: 20px;
  filter: drop-shadow(0 0 2px white) drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
  transition: transform 0.2s ease;
}

:deep(.building-marker:hover .building-icon-emoji) {
  transform: scale(1.3);
  cursor: pointer;
  filter: drop-shadow(0 0 3px white) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.7));
}

:deep(.building-tooltip) {
  background: rgba(255, 255, 255, 0.9) !important;
  border: 1px solid #666 !important;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3) !important;
  padding: 4px 8px !important;
  font-size: 12px;
  font-weight: bold;
  text-transform: capitalize;
}

/* Capital Markers - Crown Icon for Player Capitals */
:deep(.capital-marker) {
  background: transparent;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.capital-icon-emoji) {
  font-size: 28px; /* Larger than regular buildings */
  filter: drop-shadow(0 0 3px #ffd700) drop-shadow(0 2px 5px rgba(0, 0, 0, 0.6));
  transition: transform 0.2s ease;
  animation: pulse-crown 2s ease-in-out infinite;
}

@keyframes pulse-crown {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
  }
}

:deep(.capital-marker:hover .capital-icon-emoji) {
  transform: scale(1.4);
  cursor: pointer;
  filter: drop-shadow(0 0 5px #ffd700) drop-shadow(0 3px 6px rgba(0, 0, 0, 0.8));
}

:deep(.capital-tooltip) {
  background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%) !important;
  border: 2px solid #daa520 !important;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4) !important;
  padding: 6px 12px !important;
  font-size: 13px;
  font-weight: bold;
  color: #2c1810;
  font-family: 'Cinzel', 'Georgia', serif;
  letter-spacing: 0.5px;
}

/* Settlement Markers - Medieval Style with SVG */
:deep(.settlement-marker) {
  background: transparent;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.settlement-icon-svg) {
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 0 2px white) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
  transition: transform 0.2s ease;
}

:deep(.settlement-icon-svg svg) {
  width: 32px;
  height: 32px;
}

:deep(.settlement-marker:hover .settlement-icon-svg) {
  transform: scale(1.3);
  cursor: pointer;
  filter: drop-shadow(0 0 4px white) drop-shadow(0 3px 6px rgba(0, 0, 0, 0.7));
}

/* Fallback for emoji icons (if SVG fails) */
:deep(.settlement-icon) {
  font-size: 28px;
  filter: drop-shadow(0 0 2px white) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.4));
  transition: transform 0.2s ease;
}

:deep(.settlement-marker:hover .settlement-icon) {
  transform: scale(1.2);
  cursor: pointer;
}

/* Settlement Tooltip - Medieval Font with Halo */
:deep(.settlement-tooltip) {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  margin: 0 !important;
  text-align: center;
}

:deep(.settlement-tooltip::before) {
  display: none !important;
}

:deep(.settlement-label) {
  font-family: 'Cinzel', 'Georgia', 'Times New Roman', serif;
  font-size: 15px;
  font-weight: 700;
  color: #1a0d00;
  /* Halo blanco potente para máxima legibilidad sobre cualquier terreno */
  text-shadow:
    /* Capa 1: Halo blanco grueso en 8 direcciones */
    3px 3px 0 #fff,
    -3px -3px 0 #fff,
    3px -3px 0 #fff,
    -3px 3px 0 #fff,
    /* Capa 2: Halo blanco medio en 8 direcciones */
    2px 2px 0 #fff,
    -2px -2px 0 #fff,
    2px -2px 0 #fff,
    -2px 2px 0 #fff,
    /* Capa 3: Halo blanco fino en 8 direcciones */
    1px 1px 0 #fff,
    -1px -1px 0 #fff,
    1px -1px 0 #fff,
    -1px 1px 0 #fff,
    /* Capa 4: Halo en ejes cardinales */
    3px 0 0 #fff,
    -3px 0 0 #fff,
    0 3px 0 #fff,
    0 -3px 0 #fff,
    2px 0 0 #fff,
    -2px 0 0 #fff,
    0 2px 0 #fff,
    0 -2px 0 #fff,
    /* Sombra suave para profundidad */
    0 3px 5px rgba(0, 0, 0, 0.4);
  letter-spacing: 0.5px;
  white-space: nowrap;
  pointer-events: none;
}

/* Import Google Font - Moved to style.css */

/* ═══════════════════════════════════════════════════════════════════
   MOBILE TOP BAR + DRAWER  (hidden on desktop)
   ═══════════════════════════════════════════════════════════════════ */
.mobile-topbar {
  display: none;
}
.mobile-drawer-overlay {
  display: none;
}
.mobile-drawer {
  display: none;
}

/* ── Responsive: móvil ≤ 768px ──────────────────────────────────── */
@media (max-width: 768px), (max-height: 480px) and (orientation: landscape) {

  /* Ocultar sidebar completo */
  #main-sidebar,
  .main-sidebar {
    display: none !important;
  }

  /* Ocultar widget de búsqueda en móvil (se usa el drawer) */
  .h3-search-widget {
    display: none;
  }

  /* ── Top Bar ──────────────────────────────────────────────────── */
  .mobile-topbar {
    display: flex;
    align-items: center;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 48px;
    background: #110f0d;
    border-bottom: 2px solid #c5a059;
    z-index: 1100;
    padding: 0 10px;
    gap: 8px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.8);
  }

  /* Hamburger button */
  .mobile-hamburger {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    width: 36px;
    height: 36px;
    padding: 6px;
    background: rgba(197,160,89,0.1);
    border: 1px solid #c5a059;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .mobile-hamburger span {
    display: block;
    width: 100%;
    height: 2px;
    background: #c5a059;
    border-radius: 2px;
    transition: transform 0.2s, opacity 0.2s;
  }
  .mobile-hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
  .mobile-hamburger.open span:nth-child(2) { opacity: 0; }
  .mobile-hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

  /* Center: date + gold */
  .mobile-topbar-center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    overflow: hidden;
  }
  .mobile-date {
    font-size: 0.7rem;
    color: #9ca3af;
    line-height: 1;
  }
  .mobile-gold {
    font-size: 0.95rem;
    font-weight: bold;
    color: #c5a059;
    line-height: 1;
  }

  /* Right: house name */
  .mobile-topbar-right {
    font-size: 0.75rem;
    color: #e8d5b5;
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    flex-shrink: 0;
  }

  /* ── Drawer Overlay ───────────────────────────────────────────── */
  .mobile-drawer-overlay {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    z-index: 1150;
  }

  /* ── Drawer Panel ─────────────────────────────────────────────── */
  .mobile-drawer {
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0;
    left: 0;
    width: 280px;
    height: 100vh;
    background: #110f0d;
    border-right: 2px solid #c5a059;
    z-index: 1200;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    overflow-y: auto;
  }
  .mobile-drawer.open {
    transform: translateX(0);
  }

  .mobile-drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid #c5a059;
    font-size: 1rem;
    color: #c5a059;
    font-weight: bold;
    flex-shrink: 0;
  }
  .mobile-drawer-close {
    background: none;
    border: none;
    color: #9ca3af;
    font-size: 1.1rem;
    cursor: pointer;
    padding: 4px 8px;
  }

  .mobile-drawer-nav {
    display: flex;
    flex-direction: column;
    padding: 8px 0;
    flex: 1;
  }

  .mobile-drawer-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 20px;
    background: none;
    border: none;
    color: #e8d5b5;
    font-size: 0.95rem;
    text-align: left;
    cursor: pointer;
    position: relative;
    transition: background 0.15s;
  }
  .mobile-drawer-btn:active,
  .mobile-drawer-btn:hover {
    background: rgba(197,160,89,0.12);
    color: #c5a059;
  }
  .mobile-drawer-btn span:first-child {
    font-size: 1.2rem;
    width: 24px;
    text-align: center;
  }

  .mobile-badge {
    position: absolute;
    right: 16px;
    background: #b91c1c;
    color: #fff;
    font-size: 0.7rem;
    font-weight: bold;
    border-radius: 10px;
    padding: 1px 6px;
    min-width: 18px;
    text-align: center;
  }

  .mobile-drawer-footer {
    border-top: 1px solid #3a3020;
    padding: 8px 0 16px;
    flex-shrink: 0;
  }

  .mobile-drawer-logout {
    color: #f87171;
  }
  .mobile-drawer-logout:hover {
    background: rgba(185,28,28,0.15);
    color: #fca5a5;
  }

  /* ── Mapa: respetar top bar ───────────────────────────────────── */
  .map-background {
    top: 48px;
  }

  /* ── Overlays fullscreen (game-overlay) ──────────────────────── */
  .game-overlay {
    left: 0 !important;
    top: 48px !important;
    overflow-y: auto !important;
  }

  .overlay-container {
    padding: 8px 12px !important;
    overflow-y: auto !important;
    height: auto !important;
    min-height: calc(100vh - 48px) !important;
  }

  .overlay-header {
    margin-bottom: 8px !important;
    padding-bottom: 8px !important;
  }

  .overlay-title {
    font-size: 1rem !important;
  }

  .overlay-close {
    width: 30px !important;
    height: 30px !important;
    font-size: 16px !important;
    flex-shrink: 0 !important;
  }

  /* Mensajes: columnas → filas apiladas */
  .overlay-content {
    grid-template-columns: 1fr !important;
    overflow-y: visible !important;
    gap: 16px !important;
  }

  .messages-list-column,
  .message-viewer-column,
  .message-compose-column {
    max-height: none !important;
    overflow-y: visible !important;
  }

  /* ── Kingdom/Imperium: sidebar lateral → pestañas arriba ─────── */
  .kingdom-content {
    flex-direction: column !important;
    height: auto !important;
    overflow: visible !important;
  }

  .kingdom-sidebar {
    width: 100% !important;
    border-right: none !important;
    border-bottom: 2px solid var(--color-accent-gold) !important;
    flex-direction: row !important;
    flex-wrap: wrap !important;
    gap: 8px !important;
    padding: 12px !important;
    overflow-y: visible !important;
  }

  /* Ocultar el bloque de estadísticas en la sidebar en móvil */
  .kingdom-sidebar .sidebar-section:not(:first-child) {
    display: none !important;
  }

  .kingdom-sidebar .kingdom-actions-vertical {
    flex-direction: row !important;
    flex-wrap: wrap !important;
    gap: 6px !important;
  }

  .kingdom-action-btn-sidebar {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    padding: 8px 10px !important;
    font-size: 0.8rem !important;
  }

  .kingdom-main {
    overflow-y: auto !important;
    height: auto !important;
    max-height: none !important;
    flex: unset !important;
  }

  /* ── Context panel (market, notifications, layers) ────────────── */
  .context-panel {
    left: 0 !important;
    top: 48px !important;
    width: 100vw !important;
    height: calc(100vh - 48px) !important;
    padding: 0 !important;
    transform: translateX(-100%);
  }
  .context-panel.open {
    transform: translateX(0);
  }

  /* Header del panel: compacto */
  .panel-header {
    padding: 10px 14px !important;
    margin: 0 0 0 0 !important;
  }
  .panel-title {
    font-size: 13px !important;
    letter-spacing: 0.5px !important;
  }

  /* Contenido con scroll */
  .panel-content {
    padding: 0 !important;
    height: calc(100% - 45px) !important;
    overflow-y: auto !important;
  }

  /* Market: secciones compactas */
  .market-section {
    padding: 10px 12px !important;
  }
  .market-section-title {
    font-size: 10px !important;
  }
  .market-select,
  .market-worker-type-btn {
    font-size: 0.82rem !important;
  }
  .market-btn {
    padding: 7px 12px !important;
    font-size: 0.82rem !important;
  }

  /* Workers table en mercado: compacta */
  .workers-table {
    font-size: 0.78rem !important;
  }
  .workers-table th,
  .workers-table td {
    padding: 5px 4px !important;
  }

  /* Notifications: compactas */
  .notification-item {
    padding: 8px 12px !important;
    font-size: 0.8rem !important;
  }

  /* Layers/leyenda: compacta */
  .legend-section {
    padding: 10px 12px !important;
  }
  .legend-item {
    padding: 4px 0 !important;
    font-size: 0.82rem !important;
  }

  /* ── Sub-componentes: quitar height:100% para que fluyan natural ─ */
  :deep(.troops-panel),
  :deep(.naval-panel),
  :deep(.economy-panel),
  :deep(.diplomacy-panel),
  :deep(.character-panel) {
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
  }

  /* Build modal: que no se corte */
  .build-modal-overlay .build-modal {
    width: 95vw !important;
    max-height: 90vh !important;
    overflow-y: auto !important;
  }

  /* ── Ajustes de texto en mapa ─────────────────────────────────── */
  :deep(.settlement-label) { font-size: 12px; }
  :deep(.settlement-icon)  { font-size: 24px; }
}

/* Player Gold Indicator - Top Left Corner */
.player-gold-indicator {
  position: fixed;
  top: 20px;
  left: 20px; /* Moved to left edge */
  background: var(--color-bg-dark);
  border: 2px solid var(--color-accent-gold);
  border-radius: 6px;
  padding: 10px 18px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(197, 160, 89, 0.2);
  z-index: 1001;
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--font-serif);
  min-width: 150px;
}

.gold-icon {
  font-size: 28px;
  filter: sepia(1) saturate(2) hue-rotate(5deg) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
}

.gold-amount {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-accent-gold);
  text-shadow: 0 0 8px rgba(197, 160, 89, 0.4);
  font-family: var(--font-sans);
}

.gold-label {
  font-size: 11px;
  color: var(--color-text-dim);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  font-weight: 600;
}

/* Time Control Panel - Medieval Dark Style */
.time-control {
  position: fixed;
  top: 20px;
  right: 200px; /* Positioned left of gold indicator */
  background: var(--color-bg-dark);
  border: 2px solid var(--color-accent-gold);
  border-radius: 6px;
  padding: 14px 18px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(197, 160, 89, 0.15);
  z-index: 1001;
  font-family: var(--font-serif);
  min-width: 220px;
}

.time-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.time-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-cream);
}

.time-icon {
  font-size: 16px;
  filter: sepia(1) saturate(2) hue-rotate(5deg) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}

.time-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-dim);
  min-width: 50px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.time-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-cream);
  text-shadow: 0 0 6px rgba(232, 213, 181, 0.3);
  font-family: var(--font-sans);
}

.date-display {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-accent-gold);
  text-shadow: 0 0 8px rgba(197, 160, 89, 0.4);
  letter-spacing: 0.3px;
}

/* Harvest Info Row */
.harvest-info {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.harvest-label {
  font-size: 11px;
  font-style: italic;
  color: #c9a668;
  line-height: 1.4;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
  font-family: 'Georgia', serif;
}

/* Server Sync Info */
.server-time-info {
  padding: 8px 12px;
  background: rgba(76, 175, 80, 0.1);
  border: 1px solid rgba(76, 175, 80, 0.3);
  border-radius: 4px;
  margin-top: 10px;
}

.sync-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #4CAF50;
}

.sync-icon {
  font-size: 14px;
  animation: rotate-sync 2s linear infinite;
}

@keyframes rotate-sync {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.sync-text {
  font-weight: 500;
  font-family: 'Cinzel', 'Georgia', serif;
}

/* Fiefs Monitoring Panel */
.fiefs-panel {
  position: fixed;
  top: 100px; /* Moved below gold indicator */
  left: 20px; /* Aligned with gold indicator on left side */
  background: linear-gradient(135deg, #3e3e3e 0%, #2a2a2a 100%);
  border: 3px solid #5d5d5d;
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
  z-index: 1001;
  font-family: 'Cinzel', 'Georgia', serif;
  width: 240px;
  max-height: 500px;
  overflow-y: auto;
}

.fiefs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 2px solid #5d5d5d;
}

.fiefs-header h3 {
  margin: 0;
  font-size: 14px;
  color: #f4e4bc;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
}

.fiefs-count {
  background: #8B0000;
  color: #f4e4bc;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: bold;
}

.fiefs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 50px; /* Ensure list is visible even when empty */
}

.fiefs-empty {
  text-align: center;
  color: #b8a882;
  font-size: 11px;
  padding: 20px 10px;
  font-style: italic;
}

.fief-card {
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid #4a4a4a;
  border-radius: 6px;
  padding: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.fief-card:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: #7d7d7d;
  transform: translateX(-3px);
  box-shadow: 3px 0 8px rgba(0, 0, 0, 0.3);
}

.fief-name {
  font-size: 12px;
  font-weight: bold;
  color: #f4e4bc;
  margin-bottom: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fief-terrain {
  font-size: 10px;
  color: #b8a882;
  margin-bottom: 6px;
  font-style: italic;
}

.fief-stats {
  display: flex;
  justify-content: space-around;
  gap: 8px;
}

.fief-stat {
  display: flex;
  align-items: center;
  gap: 4px;
}

.fief-icon {
  font-size: 14px;
}

.fief-value {
  font-size: 11px;
  font-weight: bold;
  color: #f4e4bc;
}

/* Food alert - red text when low */
.fief-low-food .fief-food {
  color: #ff4444 !important;
  animation: pulse-warning 1.5s ease-in-out infinite;
}

@keyframes pulse-warning {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* Food increase highlight */
.fief-food.food-increased {
  color: #7FFF00 !important;
  animation: glow-green 2s ease-out;
}

@keyframes glow-green {
  0% {
    text-shadow: 0 0 10px rgba(127, 255, 0, 1);
    transform: scale(1.2);
  }
  100% {
    text-shadow: 0 0 0 rgba(127, 255, 0, 0);
    transform: scale(1);
  }
}

/* Messages Panel */
.messages-panel {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 350px;
  max-height: 400px;
  background: var(--color-bg-dark);
  border: 2px solid var(--color-accent-gold);
  border-radius: 6px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(197, 160, 89, 0.15);
  backdrop-filter: blur(10px);
  z-index: 999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.messages-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  background: rgba(0, 0, 0, 0.4);
  border-bottom: 1px solid var(--color-border);
}

.messages-header h3 {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-cream);
  font-weight: bold;
  font-family: var(--font-serif);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.messages-count {
  background: #e74c3c;
  color: white;
  font-size: 11px;
  font-weight: bold;
  padding: 2px 8px;
  border-radius: 12px;
  min-width: 20px;
  text-align: center;
}

.messages-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.messages-empty {
  text-align: center;
  color: #b8a882;
  font-size: 12px;
  padding: 20px 10px;
  font-style: italic;
}

.message-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(200, 180, 130, 0.3);
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.message-card:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(200, 180, 130, 0.6);
  transform: translateX(-3px);
  box-shadow: 3px 0 8px rgba(0, 0, 0, 0.3);
}

.message-unread {
  border-left: 3px solid #3498db;
  background: rgba(52, 152, 219, 0.1);
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.message-sender {
  font-size: 11px;
  font-weight: bold;
  color: #f39c12;
}

.message-date {
  font-size: 10px;
  color: #95a5a6;
}

.message-subject {
  font-size: 12px;
  font-weight: bold;
  color: #f4e4bc;
  margin-bottom: 4px;
}

.message-preview {
  font-size: 11px;
  color: #b8a882;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* Scrollbar styling for messages list */
.messages-list::-webkit-scrollbar {
  width: 6px;
}

.messages-list::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
}

.messages-list::-webkit-scrollbar-thumb {
  background: rgba(200, 180, 130, 0.4);
  border-radius: 3px;
}

.messages-list::-webkit-scrollbar-thumb:hover {
  background: rgba(200, 180, 130, 0.6);
}

/* Admin Link Container */
.admin-link-container {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 999;
}

.admin-link {
  display: inline-block;
  padding: 12px 20px;
  background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
  border: 2px solid rgba(231, 76, 60, 0.6);
  border-radius: 8px;
  color: white;
  text-decoration: none;
  font-size: 14px;
  font-weight: bold;
  font-family: 'Cinzel', 'Georgia', serif;
  box-shadow: 0 4px 15px rgba(231, 76, 60, 0.4);
  transition: all 0.3s;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.admin-link:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(231, 76, 60, 0.6);
  background: linear-gradient(135deg, #c0392b 0%, #a93226 100%);
}

.admin-link:active {
  transform: translateY(-1px);
}

/* Logout Container */
.logout-container {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 999;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* If admin link exists, position logout below it */
.admin-link-container + .logout-container {
  bottom: 80px; /* Position above admin link */
}

.logout-button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  background: rgba(44, 62, 80, 0.85);
  border: 2px solid rgba(149, 165, 166, 0.4);
  border-radius: 8px;
  color: #ecf0f1;
  font-size: 13px;
  font-weight: bold;
  font-family: 'Cinzel', 'Georgia', serif;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
}

.logout-button:hover {
  background: rgba(192, 57, 43, 0.85);
  border-color: rgba(231, 76, 60, 0.6);
  transform: translateY(-2px);
  box-shadow: 0 5px 15px rgba(231, 76, 60, 0.4);
}

.logout-button:active {
  transform: translateY(0);
}

.logout-icon {
  font-size: 16px;
}

.logout-text {
  letter-spacing: 0.5px;
}

.user-info {
  font-size: 11px;
  color: #95a5a6;
  text-align: center;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  font-family: 'Georgia', serif;
}

/* Message Detail Panel */
.message-detail-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 600px;
  max-width: 90vw;
  max-height: 80vh;
  background: rgba(30, 30, 40, 0.98);
  border: 3px solid rgba(200, 180, 130, 0.8);
  border-radius: 12px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(15px);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideInScale 0.3s ease-out;
}

@keyframes slideInScale {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

.message-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  background: rgba(0, 0, 0, 0.4);
  border-bottom: 2px solid rgba(200, 180, 130, 0.4);
}

.message-detail-header h3 {
  margin: 0;
  font-size: 16px;
  color: #f39c12;
  font-weight: bold;
}

.message-detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.message-detail-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(200, 180, 130, 0.2);
}

.message-detail-sender {
  font-size: 13px;
  font-weight: bold;
  color: #f39c12;
}

.message-detail-date {
  font-size: 12px;
  color: #95a5a6;
}

.message-detail-subject {
  font-size: 18px;
  color: #f4e4bc;
  margin: 0 0 15px 0;
  font-weight: bold;
}

.message-detail-content {
  font-size: 14px;
  color: #d4c4a4;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
  margin-bottom: 20px;
}

.message-detail-map-button {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
  border: none;
  border-radius: 6px;
  color: white;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s;
  font-family: 'Cinzel', 'Georgia', serif;
}

.message-detail-map-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(52, 152, 219, 0.4);
}

.close-button {
  background: rgba(231, 76, 60, 0.8);
  border: none;
  color: white;
  font-size: 18px;
  width: 30px;
  height: 30px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.close-button:hover {
  background: rgba(231, 76, 60, 1);
  transform: scale(1.1);
}

/* Scrollbar for message detail */
.message-detail-body::-webkit-scrollbar {
  width: 8px;
}

.message-detail-body::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
}

.message-detail-body::-webkit-scrollbar-thumb {
  background: rgba(200, 180, 130, 0.5);
  border-radius: 4px;
}

.message-detail-body::-webkit-scrollbar-thumb:hover {
  background: rgba(200, 180, 130, 0.7);
}

/* Harvest Banner - Central Floating Message */
.harvest-banner {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.5);
  background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
  border: 4px solid #8B4513;
  border-radius: 12px;
  padding: 30px 40px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
  z-index: 10000;
  opacity: 0;
  transition: all 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
}

.harvest-banner-show {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}

.harvest-banner-content {
  display: flex;
  align-items: center;
  gap: 20px;
}

.harvest-wheat {
  font-size: 48px;
  animation: wheat-bounce 0.8s ease-in-out infinite;
}

@keyframes wheat-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.harvest-text {
  font-family: 'Cinzel', 'Georgia', serif;
  font-size: 24px;
  font-weight: bold;
  color: #5d4e37;
  text-shadow: 2px 2px 4px rgba(255, 255, 255, 0.5);
  text-align: center;
}

.harvest-subtext {
  font-size: 14px;
  font-weight: normal;
  margin-top: 8px;
  color: #6d5a47;
}

/* Action Panel - Medieval Floating Panel */
/* Action Panel (Floating hex action panel) */
.action-panel {
  position: fixed;
  width: 300px;
  background-color: var(--color-bg-dark);
  background-image:
    url("data:image/svg+xml,%3Csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulance type='fractalNoise' baseFrequency='0.9' numOctaves='4' /%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23noise)' opacity='0.05'/%3E%3C/svg%3E");
  border: 2px solid var(--color-accent-gold);
  border-radius: 6px;
  box-shadow:
    0 8px 30px rgba(0, 0, 0, 0.8),
    inset 0 0 20px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(197, 160, 89, 0.2);
  z-index: 1100;
  overflow: hidden;
}

.action-panel-header {
  background: linear-gradient(135deg, rgba(26, 22, 18, 0.98) 0%, rgba(13, 11, 9, 0.98) 100%);
  color: var(--color-accent-gold);
  padding: 16px;
  border-bottom: 2px solid var(--color-accent-gold);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.action-panel-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  font-family: var(--font-serif);
  color: var(--color-accent-gold);
}

.action-panel .close-button {
  background: transparent;
  border: 2px solid var(--color-border);
  color: var(--color-text-cream);
  font-size: 18px;
  font-weight: bold;
  cursor: pointer;
  padding: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.3s;
}

.action-panel .close-button:hover {
  background: rgba(231, 76, 60, 0.2);
  border-color: #e74c3c;
  color: #e74c3c;
}

.action-panel-body {
  padding: 16px;
}

.hex-info {
  margin-bottom: 16px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  border: 2px solid var(--color-border);
}

.hex-info p {
  margin: 6px 0;
  font-size: 13px;
  color: var(--color-text-cream);
  font-family: var(--font-sans);
}

.hex-info strong {
  color: var(--color-accent-gold);
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action-button {
  padding: 14px 20px;
  font-family: var(--font-serif);
  font-size: 13px;
  font-weight: 600;
  border: 2px solid;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s ease;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.colonize-button {
  background: var(--color-accent-gold);
  color: var(--color-bg-dark);
  border-color: var(--color-accent-gold);
  box-shadow: 0 4px 12px rgba(197, 160, 89, 0.4);
}

.colonize-button:hover:not(:disabled) {
  background: var(--color-hover);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(197, 160, 89, 0.6);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
}

.colonize-button:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.colonize-button:disabled {
  background: rgba(0, 0, 0, 0.4);
  border-color: var(--color-border);
  color: var(--color-text-dim);
  cursor: not-allowed;
  opacity: 0.5;
  box-shadow: none;
}

.owned-message {
  padding: 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 2px solid var(--color-border);
  border-radius: 4px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text-cream);
  font-family: var(--font-sans);
}

.owned-message p {
  margin: 6px 0;
}

/* Mobile adjustments for gold indicator and action panel */
@media (max-width: 768px), (max-height: 480px) and (orientation: landscape) {
  .player-gold-indicator {
    top: 10px;
    left: 10px; /* Keep on left side for mobile */
    padding: 8px 15px;
    min-width: 120px;
  }

  .gold-icon {
    font-size: 24px;
  }

  .gold-amount {
    font-size: 20px;
  }

  .gold-label {
    font-size: 10px;
  }

  .time-control {
    top: auto;
    bottom: 20px;
    right: 10px;
    left: 10px;
    padding: 10px 12px;
    min-width: auto;
  }

  .time-row {
    gap: 4px;
  }

  .time-icon {
    font-size: 14px;
  }

  .time-label {
    font-size: 11px;
    min-width: 40px;
  }

  .time-value {
    font-size: 12px;
  }

  .btn-next-turn {
    font-size: 11px;
    padding: 6px 10px;
  }

  .action-panel {
    width: calc(100% - 40px);
    max-width: 300px;
    left: 50% !important;
    transform: translateX(-50%);
  }
}

/* ============================================
   Building Construction Modal
   ============================================ */
.build-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  z-index: 9500;
  display: flex;
  align-items: center;
  justify-content: center;
}

.build-modal {
  background: #1c1814;
  border: 2px solid #c5a059;
  border-radius: 10px;
  padding: 24px;
  width: 600px;
  max-width: 95vw;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.7);
  font-family: 'Cinzel', serif;
}

.build-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.build-modal-title {
  color: #ffd700;
  font-size: 1.3rem;
  margin: 0;
}

.build-modal-close {
  background: none;
  border: 1px solid #5d4e37;
  color: #e8d5b5;
  font-size: 1rem;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.build-modal-close:hover {
  background: rgba(197, 160, 89, 0.2);
  border-color: #c5a059;
}

.build-modal-subtitle {
  color: #a89875;
  font-size: 0.78rem;
  margin: 0 0 18px;
  font-family: monospace;
}

.build-modal-h3 {
  color: #e8d5b5;
}

.build-cards-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.build-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid #5d4e37;
  border-radius: 8px;
  padding: 12px 14px;
  transition: border-color 0.2s, background 0.2s;
}

.build-card:hover:not(.build-card-disabled) {
  border-color: #c5a059;
  background: rgba(197, 160, 89, 0.08);
}

.build-card-disabled {
  opacity: 0.5;
}

.build-card-icon {
  font-size: 2rem;
  min-width: 40px;
  text-align: center;
}

.build-card-info {
  flex: 1;
}

.build-card-name {
  color: #ffd700;
  font-size: 1rem;
  margin: 0 0 2px;
}

.build-card-type {
  color: #a89875;
  font-size: 0.72rem;
  margin: 0 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.build-card-desc {
  color: #c8b89a;
  font-size: 0.82rem;
  margin: 0 0 8px;
  font-family: 'Palatino Linotype', serif;
  font-style: italic;
}

.build-card-stats {
  display: flex;
  gap: 12px;
}

.build-stat {
  color: #e8d5b5;
  font-size: 0.82rem;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  padding: 2px 8px;
}

.build-stat-food {
  color: #4caf50;
}

.build-card-btn {
  background: linear-gradient(135deg, #8b6914, #c5a059);
  border: none;
  color: #1c1814;
  font-family: 'Cinzel', serif;
  font-size: 0.85rem;
  font-weight: bold;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  min-width: 90px;
}

.build-card-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #c5a059, #ffd700);
  transform: translateY(-1px);
}

.build-card-btn:disabled {
  background: #3a3028;
  color: #6a5a40;
  cursor: not-allowed;
}

.build-empty {
  text-align: center;
  color: #a89875;
  font-style: italic;
  padding: 30px;
}

.upgrade-preview {
  padding: 8px 0;
}

.upgrade-card {
  border-color: rgba(93, 63, 211, 0.5) !important;
  background: rgba(30, 20, 60, 0.6) !important;
}

.upgrade-warning {
  text-align: center;
  color: #ff9800;
  font-size: 0.82rem;
  margin-top: 10px;
  padding: 6px 12px;
  background: rgba(255, 152, 0, 0.1);
  border: 1px solid rgba(255, 152, 0, 0.3);
  border-radius: 6px;
}

/* Toast Notifications - Bottom Right Corner */
.toast-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 400px;
}

.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  animation: toast-slide-in 0.3s ease-out;
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
  border: 2px solid;
  backdrop-filter: blur(10px);
}

.toast-leaving {
  opacity: 0;
  transform: translateX(400px);
}

@keyframes toast-slide-in {
  from {
    opacity: 0;
    transform: translateX(400px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.toast-icon {
  font-size: 20px;
  flex-shrink: 0;
  filter: sepia(1) saturate(1.5) hue-rotate(5deg);
}

.toast-message {
  flex: 1;
  line-height: 1.5;
  white-space: pre-line;
}

.toast-success {
  background: rgba(26, 22, 18, 0.98);
  border-color: #c5a059;
  color: #e8d5b5;
  box-shadow: 0 4px 15px rgba(197, 160, 89, 0.4);
}

.toast-error {
  background: rgba(26, 22, 18, 0.98);
  border-color: #c0392b;
  color: #ff6b6b;
  box-shadow: 0 4px 15px rgba(192, 57, 43, 0.4);
}

.toast-warning {
  background: rgba(26, 22, 18, 0.98);
  border-color: #e67e22;
  color: #f39c12;
  box-shadow: 0 4px 15px rgba(230, 126, 34, 0.4);
}

.toast-info {
  background: rgba(26, 22, 18, 0.98);
  border-color: #3498db;
  color: #5dade2;
  box-shadow: 0 4px 15px rgba(52, 152, 219, 0.4);
}

/* Cell Details Popup - Enhanced Styling */
:deep(.cell-details-popup .leaflet-popup-content-wrapper) {
  background: linear-gradient(135deg, #f4e4bc 0%, #e8d4a8 100%);
  border: 3px solid #5d4e37;
  border-radius: 8px;
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
  padding: 0;
}

:deep(.cell-details-popup .leaflet-popup-content) {
  margin: 0;
  font-family: 'Cinzel', 'Georgia', serif;
}

:deep(.cell-details-popup .leaflet-popup-tip) {
  background: #e8d4a8;
  border: 3px solid #5d4e37;
  border-top: none;
  border-right: none;
}

/* Capital Badge - Highlighted banner in popup */
.capital-badge {
  background: linear-gradient(45deg, #ffd700, #ff8c00);
  color: #000;
  text-align: center;
  font-weight: bold;
  padding: 6px 4px;
  border-radius: 4px;
  margin-bottom: 8px;
  box-shadow: 0 0 8px rgba(255, 215, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  font-size: 11px;
  letter-spacing: 1px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  animation: pulse-gold 2s ease-in-out infinite;
}

@keyframes pulse-gold {
  0%, 100% {
    box-shadow: 0 0 8px rgba(255, 215, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
  50% {
    box-shadow: 0 0 15px rgba(255, 215, 0, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
}

/* Mobile adjustments for toasts */
@media (max-width: 768px), (max-height: 480px) and (orientation: landscape) {
  .toast-container {
    bottom: 10px;
    right: 10px;
    left: 10px;
    max-width: none;
  }

  .toast {
    padding: 12px 15px;
    font-size: 13px;
  }

  .toast-icon {
    font-size: 18px;
  }
}

/* Capital hexagon styling - render on top with higher z-index */
:deep(.capital-hexagon) {
  z-index: 1000 !important;
}

:deep(.capital-hexagon path) {
  stroke-width: 6 !important;
  stroke: #ff0000 !important;
  stroke-opacity: 1.0 !important;
  filter: drop-shadow(0 0 8px rgba(255, 0, 0, 0.6));
}

/* Capital star marker styling - Moved to style.css */

/* Legacy support for old class name */
:deep(.capital-star-label) {
  font-size: 24px;
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
  line-height: 30px;
  filter: drop-shadow(0 0 3px gold) drop-shadow(0 0 6px rgba(255, 215, 0, 0.8));
  pointer-events: none;
  z-index: 10000 !important;
}

/* ============================================
   FULL-SCREEN MESSAGES OVERLAY
   ============================================ */
.game-overlay {
  position: fixed;
  top: 0;
  left: 300px; /* After sidebar */
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg,
    rgba(26, 22, 18, 0.98) 0%,
    rgba(13, 11, 9, 0.98) 100%
  );
  z-index: 950; /* Above map (1), below sidebar (1000) */
  overflow: hidden;
  backdrop-filter: blur(8px);
}

.overlay-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 30px;
}

.overlay-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
  padding-bottom: 20px;
  border-bottom: 2px solid var(--color-accent-gold);
}

.overlay-title {
  font-family: 'Cinzel', serif;
  font-size: 2.5em;
  color: var(--color-accent-gold);
  text-shadow: 0 0 15px rgba(197, 160, 89, 0.4);
  margin: 0;
}

.overlay-close {
  background: transparent;
  border: 2px solid var(--color-accent-gold);
  color: var(--color-accent-gold);
  font-size: 28px;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
}

.overlay-close:hover {
  background: var(--color-accent-gold);
  color: var(--color-bg-dark);
  transform: rotate(90deg);
  box-shadow: 0 4px 15px rgba(197, 160, 89, 0.6);
}

.overlay-content {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1.5fr 1fr;
  gap: 25px;
  overflow: hidden;
}

/* Column Styling */
.messages-list-column,
.message-viewer-column,
.message-compose-column {
  background: rgba(0, 0, 0, 0.3);
  border: 2px solid var(--color-accent-gold);
  border-radius: 8px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(197, 160, 89, 0.2);
}

.column-title {
  font-family: 'Cinzel', serif;
  font-size: 1.3em;
  color: var(--color-accent-gold);
  margin: 0 0 18px 0;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
  text-transform: uppercase;
  letter-spacing: 1px;
}

/* Message Tabs */
.message-tabs {
  display: flex;
  gap: 5px;
  margin-bottom: 15px;
  border-bottom: 2px solid var(--color-border);
}

.tab-button {
  flex: 1;
  padding: 12px 20px;
  background: rgba(0, 0, 0, 0.3);
  border: none;
  border-bottom: 3px solid transparent;
  color: var(--color-text-dim);
  font-family: 'Inter', sans-serif;
  font-size: 0.95em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.tab-button:hover {
  background: rgba(0, 0, 0, 0.5);
  color: var(--color-text-cream);
}

.tab-button.active {
  background: rgba(197, 160, 89, 0.15);
  border-bottom-color: var(--color-accent-gold);
  color: var(--color-accent-gold);
  box-shadow: 0 2px 8px rgba(197, 160, 89, 0.3);
}

/* Messages List */
.messages-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.message-item {
  padding: 12px;
  margin-bottom: 10px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--color-border);
  border-left: 3px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.message-item:hover {
  background: rgba(197, 160, 89, 0.1);
  border-left-color: var(--color-accent-gold);
  transform: translateX(3px);
}

.message-item.message-selected {
  background: rgba(197, 160, 89, 0.2);
  border-left-color: var(--color-accent-gold);
  border-color: var(--color-accent-gold);
}

.message-item.message-unread {
  background: rgba(41, 128, 185, 0.15);
  border-left-color: #2980b9;
}

.message-item.message-unread.message-selected {
  background: rgba(197, 160, 89, 0.2);
  border-left-color: var(--color-accent-gold);
}

.message-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 0.85em;
}

.message-sender {
  font-weight: bold;
  color: var(--color-accent-gold);
}

.message-date {
  color: var(--color-text-dim);
  font-size: 0.9em;
}

.message-subject {
  color: var(--color-text-cream);
  font-size: 0.95em;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Message Viewer */
.message-viewer {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.message-header {
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--color-border);
}

.message-title {
  font-family: 'Cinzel', serif;
  font-size: 1.4em;
  color: var(--color-text-cream);
  margin: 0 0 12px 0;
}

.message-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.9em;
  color: var(--color-text-dim);
}

.message-from {
  color: var(--color-accent-gold);
  font-weight: 500;
}

.message-time {
  font-size: 0.85em;
}

.message-body {
  flex: 1;
  overflow-y: auto;
  padding: 15px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  line-height: 1.6;
  color: var(--color-text-cream);
  font-size: 1em;
  white-space: pre-wrap;
}

.message-actions {
  margin-top: 15px;
  display: flex;
  gap: 10px;
}

.message-actions .btn-secondary {
  background: rgba(77, 61, 43, 0.5);
  border-color: #4d3d2b;
}

.message-actions .btn-secondary:hover {
  background: rgba(77, 61, 43, 0.8);
}

/* Thread View */
.message-thread {
  margin-top: 25px;
  border-top: 2px solid #4d3d2b;
  padding-top: 20px;
}

.thread-title {
  font-family: 'Cinzel', serif;
  color: var(--color-accent-gold);
  font-size: 1.1em;
  margin-bottom: 15px;
  letter-spacing: 0.5px;
}

.thread-messages {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.thread-message {
  background: rgba(0, 0, 0, 0.3);
  border-left: 3px solid #4d3d2b;
  padding: 12px 15px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.thread-message:hover {
  background: rgba(0, 0, 0, 0.4);
  border-left-color: #c5a059;
}

.thread-message-current {
  background: rgba(197, 160, 89, 0.15);
  border-left-color: #c5a059;
  box-shadow: 0 0 10px rgba(197, 160, 89, 0.2);
}

.thread-message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.thread-message-header strong {
  color: var(--color-accent-gold);
  font-size: 0.95em;
}

.thread-message-date {
  font-size: 0.8em;
  color: var(--color-text-dim);
}

.thread-message-subject {
  font-size: 0.9em;
  color: var(--color-text-cream);
  margin-bottom: 6px;
  font-style: italic;
}

.thread-message-body {
  font-size: 0.9em;
  color: #a89875;
  line-height: 1.4;
}

/* Compose Form */
.message-compose-form {
  display: flex;
  flex-direction: column;
  gap: 15px;
  flex: 1;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-weight: 600;
  color: var(--color-text-dim);
  font-size: 0.9em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.form-group input,
.form-group textarea {
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.4);
  border: 2px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-cream);
  font-size: 1em;
  font-family: 'Inter', sans-serif;
  transition: all 0.3s;
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--color-accent-gold);
  background: rgba(0, 0, 0, 0.5);
  box-shadow: 0 0 10px rgba(197, 160, 89, 0.3);
}

.form-group textarea {
  resize: vertical;
  min-height: 150px;
  line-height: 1.5;
}

/* Buttons */
.btn-primary,
.btn-send {
  padding: 12px 24px;
  background: var(--color-accent-gold);
  color: var(--color-bg-dark);
  border: 2px solid rgba(197, 160, 89, 0.3);
  border-radius: 6px;
  font-family: 'Cinzel', serif;
  font-size: 1em;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 1px;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 4px 12px rgba(197, 160, 89, 0.4);
}

.btn-primary:hover,
.btn-send:hover {
  background: #d4b06a;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(197, 160, 89, 0.6);
}

.btn-primary:active,
.btn-send:active {
  transform: translateY(0);
}

.btn-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.btn-send {
  width: 100%;
  margin-top: auto;
}

/* Empty State */
.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-dim);
  font-size: 1.1em;
  text-align: center;
}

.empty-state p {
  padding: 30px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px dashed var(--color-border);
  border-radius: 8px;
}

.text-consumption {
  color: #ff6666 !important;
}

.text-right {
  text-align: right !important;
}

.h3-cell {
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.75rem !important;
  color: var(--color-text-dim);
  letter-spacing: -0.5px;
}

.tight-col {
  width: 1%;
  white-space: nowrap !important;
  padding-left: 4px !important;
  padding-right: 4px !important;
}

/* ========================================
   MILITARY RECRUITMENT PANEL
   ======================================== */
.divisions-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: linear-gradient(135deg, #0f0a04 0%, #1a1208 100%);
}

.military-recruitment-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 20px;
  background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
}

.recruitment-header {
  text-align: center;
  margin-bottom: 30px;
  padding-bottom: 20px;
  border-bottom: 2px solid rgba(255, 215, 0, 0.3);
}

.recruitment-header h3 {
  font-size: 2rem;
  margin: 0 0 10px 0;
  color: #ffd700;
  text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
}

.recruitment-subtitle {
  color: rgba(255, 255, 255, 0.7);
  margin: 0;
}

.recruitment-content {
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.recruitment-section {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 215, 0, 0.2);
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}

.recruitment-section h4 {
  color: #ffd700;
  margin: 0 0 15px 0;
  font-size: 1.3rem;
  border-bottom: 1px solid rgba(255, 215, 0, 0.2);
  padding-bottom: 10px;
}

.recruitment-section h5 {
  color: #ffd700;
  margin: 15px 0 10px 0;
  font-size: 1rem;
}

.recruitment-select {
  width: 100%;
  padding: 12px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 215, 0, 0.3);
  border-radius: 4px;
  color: #fff;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.recruitment-select:hover {
  border-color: rgba(255, 215, 0, 0.6);
}

.recruitment-select:focus {
  outline: none;
  border-color: #ffd700;
  box-shadow: 0 0 10px rgba(255, 215, 0, 0.3);
}

.fief-resources {
  margin-top: 15px;
  padding: 15px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.resource-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.resource-grid span {
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-weight: 600;
}

.unit-types-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 15px;
  margin-top: 15px;
}

.unit-card {
  background: rgba(0, 0, 0, 0.5);
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  padding: 15px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.unit-card:hover {
  border-color: rgba(255, 215, 0, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(255, 215, 0, 0.2);
}

.unit-card.selected {
  border-color: #ffd700;
  background: rgba(255, 215, 0, 0.1);
  box-shadow: 0 0 20px rgba(255, 215, 0, 0.3);
}

.unit-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.unit-card-header h5 {
  margin: 0;
  color: #ffd700;
  font-size: 1.2rem;
}

.unit-stats {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.7);
}

.unit-flavor {
  color: rgba(255, 255, 255, 0.6);
  font-style: italic;
  font-size: 0.9rem;
  margin: 10px 0;
  min-height: 40px;
}

.unit-requirements {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.unit-requirements strong {
  color: #ffd700;
  font-size: 0.9rem;
  display: block;
  margin-bottom: 8px;
}

.req-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.req-item {
  padding: 4px 8px;
  background: rgba(0, 100, 0, 0.3);
  border: 1px solid rgba(0, 255, 0, 0.3);
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 600;
}

.req-item.req-insufficient {
  background: rgba(100, 0, 0, 0.3);
  border-color: rgba(255, 0, 0, 0.5);
  color: #ff6b6b;
}

.unit-upkeep {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.unit-upkeep small {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.85rem;
}

.recruitment-form {
  background: rgba(255, 215, 0, 0.05);
  border-color: rgba(255, 215, 0, 0.4);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 15px;
  margin-bottom: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
}

.form-group label {
  color: #ffd700;
  font-weight: 600;
  margin-bottom: 8px;
}

.recruitment-input {
  padding: 10px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 215, 0, 0.3);
  border-radius: 4px;
  color: #fff;
  font-size: 1rem;
  transition: all 0.2s ease;
}

.recruitment-input:focus {
  outline: none;
  border-color: #ffd700;
  box-shadow: 0 0 10px rgba(255, 215, 0, 0.3);
}

.total-cost {
  background: rgba(0, 0, 0, 0.5);
  padding: 15px;
  border-radius: 4px;
  margin-bottom: 20px;
}

.total-cost h5 {
  margin: 0 0 10px 0;
}

.cost-breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.cost-item {
  padding: 8px 16px;
  background: rgba(0, 100, 0, 0.3);
  border: 2px solid rgba(0, 255, 0, 0.3);
  border-radius: 4px;
  font-weight: 600;
  font-size: 1.1rem;
}

.cost-item.cost-insufficient {
  background: rgba(100, 0, 0, 0.3);
  border-color: rgba(255, 0, 0, 0.5);
  color: #ff6b6b;
}

.recruitment-message {
  padding: 12px;
  border-radius: 4px;
  margin-bottom: 15px;
  text-align: center;
  font-weight: 600;
}

.recruitment-message.success {
  background: rgba(0, 100, 0, 0.3);
  border: 1px solid rgba(0, 255, 0, 0.5);
  color: #4caf50;
}

.recruitment-message.error {
  background: rgba(100, 0, 0, 0.3);
  border: 1px solid rgba(255, 0, 0, 0.5);
  color: #ff6b6b;
}

.btn-recruit {
  width: 100%;
  padding: 15px;
  background: linear-gradient(135deg, #c9b037 0%, #ffd700 100%);
  border: none;
  border-radius: 8px;
  color: #000;
  font-size: 1.2rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 15px rgba(255, 215, 0, 0.3);
}

.btn-recruit:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(255, 215, 0, 0.5);
}

.btn-recruit:active:not(:disabled) {
  transform: translateY(0);
}

.btn-recruit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading-text {
  text-align: center;
  padding: 40px;
  color: rgba(255, 255, 255, 0.6);
  font-style: italic;
}

.kingdom-action-btn-sidebar.active {
  background: rgba(255, 215, 0, 0.2);
  border-color: #ffd700;
  color: #ffd700;
}

/* Rediseño Tabla Reino y Reclutamiento */
.dimmed-dash {
  color: rgba(255, 255, 255, 0.2);
  font-weight: bold;
}

.table-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  align-items: center;
}

.fief-resources-compact {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 15px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 6px;
  border: 1px solid rgba(255, 215, 0, 0.3);
}

.resource-pill {
  padding: 6px 14px;
  background: rgba(26, 22, 18, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  font-size: 0.95rem;
  font-weight: 600;
  color: #e8d5b5;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.unit-card.unit-unaffordable {
  opacity: 0.6;
  filter: grayscale(0.5);
  cursor: not-allowed;
}

.unit-card.unit-affordable {
  border-color: rgba(0, 255, 0, 0.2);
}

.unit-card.unit-affordable:hover {
  border-color: rgba(0, 255, 0, 0.5);
}

.insufficient-fief-resources {
  margin-top: 12px;
  padding: 4px;
  font-size: 0.8rem;
  color: #ff6b6b;
  text-align: center;
  font-style: italic;
  background: rgba(255, 0, 0, 0.1);
  border-radius: 4px;
}

.btn-back-to-fiefs {
  background: transparent;
  border: 1px solid #ffd700;
  color: #ffd700;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Cinzel', serif;
  font-size: 0.9rem;
  transition: all 0.3s ease;
  width: 100%;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.btn-back-to-fiefs:hover {
  background: rgba(255, 215, 0, 0.15);
  transform: translateX(-5px);
}

.btn-recruit-micro {
  background: rgba(255, 215, 0, 0.1) !important;
  color: #ffd700 !important;
  border-color: rgba(255, 215, 0, 0.3) !important;
}

.btn-recruit-micro:hover {
  background: rgba(255, 215, 0, 0.2) !important;
  border-color: #ffd700 !important;
}

.current-fief-mini {
  padding: 15px !important;
  border-color: rgba(255, 215, 0, 0.4) !important;
}

/* ============================================
   HEX STACKER MARKER
   ============================================ */

/* ── Character map markers ─────────────────────────────────────── */
:deep(.char-map-marker) {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  color: #c5a059;
  filter: drop-shadow(0 1px 3px rgba(0,0,0,0.8));
  cursor: default;
}

:deep(.char-map-marker svg) {
  background: #1a1008;
  border: 2px solid #c5a059;
  border-radius: 50%;
  padding: 2px;
  width: 22px;
  height: 22px;
  box-sizing: border-box;
  box-shadow: 0 2px 6px rgba(0,0,0,0.6);
}

:deep(.char-map-marker--main svg) {
  border-color: #ffd700;
  color: #ffd700;
  box-shadow: 0 0 8px 2px rgba(255,215,0,0.5);
}

:deep(.char-map-marker--enemy) {
  color: var(--enemy-color, #e53e3e);
}
:deep(.char-map-marker--enemy svg) {
  background: #1a0808;
  border-color: var(--enemy-color, #e53e3e);
  box-shadow: 0 0 6px 1px color-mix(in srgb, var(--enemy-color, #e53e3e) 40%, transparent);
}


:deep(.char-map-name) {
  font-size: 9px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px #000, 0 0 4px #000;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

:deep(.char-map-tooltip) {
  background: rgba(20, 12, 4, 0.92);
  border: 1px solid rgba(197,160,89,0.5);
  color: #e8d5a3;
  border-radius: 5px;
  font-size: 12px;
  padding: 4px 8px;
}

:deep(.char-leaflet-popup .leaflet-popup-content-wrapper) {
  background: #1a1008;
  border: 1px solid rgba(197,160,89,0.4);
  border-radius: 8px;
  color: #e8d5a3;
  box-shadow: 0 4px 16px rgba(0,0,0,0.6);
  padding: 0;
}
:deep(.char-leaflet-popup .leaflet-popup-tip) {
  background: #1a1008;
}
:deep(.char-leaflet-popup .leaflet-popup-content) {
  margin: 0;
}

:deep(.char-popup) {
  padding: 10px 12px;
  min-width: 180px;
}
:deep(.char-popup-header) {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
}
:deep(.char-popup-icon) {
  font-size: 1.4rem;
  line-height: 1;
}
:deep(.char-popup-name) {
  font-size: 0.85rem;
  font-weight: 700;
  color: #e8d5a3;
  line-height: 1.3;
}
:deep(.char-popup-meta) {
  font-size: 0.68rem;
  color: #a89070;
  margin-top: 2px;
}
:deep(.char-popup-actions) {
  display: flex;
  gap: 6px;
  justify-content: flex-start;
}
:deep(.char-popup-moving) {
  font-size: 0.65rem;
  color: #ffd93d;
  font-weight: 600;
  vertical-align: middle;
}

/* Strip Leaflet's default divIcon styles so our container is clean */
:deep(.hex-stacker-icon) {
  background: none !important;
  border: none !important;
  /* overflow:visible lets the troop count badge peek outside the icon box */
  overflow: visible !important;
}

/* The outer wrapper div generated by HexStacker.js */
:deep(.hex-stacker) {
  overflow: visible;
}

/* The troops slot — pointer-events come from inline style, but ensure cursor */
:deep(.hex-stacker .hs-troops) {
  cursor: pointer;
}

/* H3 Search Widget */
.h3-search-widget {
  position: fixed;
  top: 12px;
  left: 312px; /* 300px sidebar + 12px gap */
  z-index: 1000;
  display: flex;
  gap: 4px;
  align-items: center;
}

.h3-search-input {
  width: 160px;
  padding: 5px 8px;
  background: rgba(17, 15, 13, 0.85);
  border: 1px solid #5a4a2a;
  border-radius: 4px;
  color: #d4b483;
  font-size: 12px;
  outline: none;
  backdrop-filter: blur(4px);
}

.h3-search-input::placeholder {
  color: #7a6a4a;
}

.h3-search-input:focus {
  border-color: #c8a96e;
}

.h3-search-btn {
  padding: 5px 8px;
  background: rgba(17, 15, 13, 0.85);
  border: 1px solid #5a4a2a;
  border-radius: 4px;
  color: #d4b483;
  font-size: 12px;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: border-color 0.15s;
}

.h3-search-btn:hover {
  border-color: #c8a96e;
}

/* ── Staging notice ─────────────────────────────────────────── */
.staging-notice-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
}
.staging-notice-box {
  background: #1a1a2e;
  border: 1px solid #c8a96e;
  border-radius: 10px;
  padding: 32px 36px;
  max-width: 460px;
  width: 90%;
  text-align: center;
  color: #e2d5b0;
}
.staging-notice-icon { font-size: 36px; margin-bottom: 10px; }
.staging-notice-title {
  font-size: 20px;
  font-weight: 700;
  color: #c8a96e;
  margin-bottom: 16px;
}
.staging-notice-list {
  text-align: left;
  font-size: 14px;
  line-height: 1.7;
  padding-left: 20px;
  margin-bottom: 20px;
  color: #d4c5a0;
}
.staging-notice-manual {
  display: inline-block;
  margin-bottom: 20px;
  color: #c8a96e;
  font-size: 14px;
  text-decoration: none;
  border: 1px solid #c8a96e;
  padding: 6px 16px;
  border-radius: 6px;
}
.staging-notice-manual:hover { background: rgba(200,169,110,0.15); }
.staging-notice-btn {
  display: block;
  width: 100%;
  padding: 10px;
  background: #c8a96e;
  color: #1a1a2e;
  font-weight: 700;
  font-size: 15px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.staging-notice-btn:hover { background: #d4b97e; }
</style>
