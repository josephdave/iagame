# Un Asado con la IA 🔥

Juego interactivo de equipos con códigos QR, desarrollado con Node.js y Socket.IO.

## Características

- ✅ Registro de jugadores con códigos QR
- ✅ Asignación automática de equipos balanceados
- ✅ Programación de partidas con countdown
- ✅ Recolección de items mediante escaneo QR
- ✅ Sistema de items de penalización
- ✅ Dashboard en tiempo real
- ✅ Webhooks para notificaciones
- ✅ Interfaz responsive

## Instalación

1. Clona o descarga el proyecto
2. Instala las dependencias:
   ```bash
   npm install
   ```

## Configuración

### Configuración del juego (`config/game-config.json`)

```json
{
  "game": {
    "duration_minutes": 30,          // Duración del juego en minutos
    "max_teams": 4,                  // Número máximo de equipos
    "items_per_team": 5,             // Items que debe recolectar cada equipo
    "penalty_items_count": 3,        // Cantidad de items de penalización
    "webhook_url": "https://tu-webhook.com/endpoint", // URL para notificaciones
    "qr_codes": ["QR001", "QR002", ...], // Lista de códigos QR disponibles
    "team_colors": [                 // Colores de los equipos
      {"name": "Azul", "color": "#3498db"},
      {"name": "Rojo", "color": "#e74c3c"},
      {"name": "Verde", "color": "#2ecc71"},
      {"name": "Amarillo", "color": "#f1c40f"}
    ]
  }
}
```

### Items del juego (`config/items.json`)

```json
{
  "items": [
    {
      "nombre": "Papa",
      "imagen": "https://example.com/images/papa.jpg"
    }
  ],
  "penalty_items": [
    {
      "nombre": "Lluvia",
      "imagen": "https://example.com/images/lluvia.jpg"
    }
  ]
}
```

## Uso

### 1. Iniciar el servidor

```bash
npm start
```

Para desarrollo con recarga automática:
```bash
npm run dev
```

El servidor se ejecutará en `http://localhost:3000`

### 2. Acceder a las interfaces

- **Jugadores**: `http://localhost:3000/` - Página principal para registro y juego
- **Dashboard**: `http://localhost:3000/dashboard` - Panel de monitoreo en tiempo real
- **Controles**: `http://localhost:3000/controles` - Panel de administración del juego
- **Escaneo QR**: `http://localhost:3000/scan/{QR_ID}` - Página de escaneo de códigos

### 3. Flujo del juego

1. **Registro**: Los jugadores escanean un código QR para registrarse
2. **Programación**: Un administrador programa la próxima partida desde el dashboard
3. **Espera**: Los jugadores ven el countdown hasta el inicio
4. **Inicio**: El juego comienza automáticamente y asigna equipos
5. **Recolección**: Los jugadores escanean códigos QR para recolectar items
6. **Finalización**: El juego termina por tiempo o por completar todos los items

## API Endpoints

### POST `/api/set-next-game`
Programa la próxima partida.

```json
{
  "datetime": "2024-01-01T15:00:00"
}
```

### GET `/api/game-state`
Obtiene el estado actual del juego.

### GET `/api/players`
Obtiene la lista de jugadores registrados.

### POST `/api/start-game-now`
Inicia el juego inmediatamente.

### POST `/api/end-game`
Termina el juego actual.

### POST `/api/reset-game`
Reinicia completamente el estado del juego.

### POST `/api/clear-players`
Elimina todos los jugadores registrados.

### GET `/api/qr-item/{qrId}`
Obtiene información del item asociado a un código QR.

### GET `/api/generate-qr/{qrId}`
Genera un código QR para el ID especificado.

## Eventos Socket.IO

### Cliente → Servidor
- `registerPlayer`: Registra un nuevo jugador
- `scanQR`: Escanea un código QR
- `reconnectPlayer`: Reconecta un jugador existente

### Servidor → Cliente
- `playerRegistered`: Confirmación de registro
- `gameScheduled`: Juego programado
- `gameStarted`: Juego iniciado
- `gameStateUpdate`: Actualización del estado
- `itemScanned`: Item escaneado
- `gameFinished`: Juego terminado
- `timeUpdate`: Actualización del tiempo

## Características Técnicas

### Lógica de Equipos
- Asignación aleatoria y balanceada
- Distribución equitativa de jugadores
- Items únicos por equipo

### Sistema de Penalizaciones
- Items especiales que inhabilitan al jugador
- Cantidad configurable de items de penalización
- Visualización en tiempo real

### Webhooks
- Notificaciones automáticas de acciones
- Mensajes personalizados por evento
- Configuración opcional

### Persistencia
- Cookies para identificación de jugadores
- Estado del juego en memoria
- Configuración mediante archivos JSON

## Personalización

### Modificar Items
Edita `config/items.json` para cambiar los items disponibles y sus imágenes.

### Cambiar Colores de Equipos
Modifica `config/game-config.json` para personalizar nombres y colores.

### Ajustar Duración
Cambia `duration_minutes` en la configuración del juego.

### Configurar Webhooks
Actualiza `webhook_url` con tu endpoint de notificaciones.

## Desarrollo

### Estructura del Proyecto
```
iagame/
├── config/
│   ├── game-config.json
│   └── items.json
├── public/
│   ├── index.html
│   ├── dashboard.html
│   └── scan.html
├── server.js
├── package.json
└── README.md
```

### Tecnologías Utilizadas
- Node.js
- Express.js
- Socket.IO
- QRCode.js
- Axios

## Solución de Problemas

### El juego no inicia
- Verifica que la fecha/hora programada sea correcta
- Revisa que haya jugadores registrados

### Los códigos QR no funcionan
- Asegúrate de que los IDs coincidan con la configuración
- Verifica que el servidor esté accesible

### Los webhooks no se envían
- Confirma que la URL del webhook sea válida
- Revisa la conectividad de red

## Licencia

Este proyecto está bajo la Licencia ISC.