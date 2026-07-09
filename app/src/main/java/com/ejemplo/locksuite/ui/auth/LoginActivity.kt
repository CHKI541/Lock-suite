package com.ejemplo.locksuite.ui.auth

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.OnBackPressedCallback
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Language
import com.ejemplo.locksuite.util.LocaleManager
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ejemplo.locksuite.R
import com.ejemplo.locksuite.security.LockoutState
import com.ejemplo.locksuite.security.LockoutStatus
import com.ejemplo.locksuite.security.PinManager
import com.ejemplo.locksuite.security.SessionManager
import com.ejemplo.locksuite.ui.dashboard.DashboardActivity
import kotlinx.coroutines.delay

class LoginActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        com.ejemplo.locksuite.util.LocaleManager.init(this)
        
        // Proteger actividad contra capturas de pantalla/grabaciones (H12)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)

        // Redirigir a la configuración si no existe PIN
        if (!PinManager.isPinConfigured(this)) {
            startActivity(Intent(this, SetupPinActivity::class.java))
            finish()
            return
        }

        // Si la sesión ya estaba activa, pasar directamente al Dashboard
        if (SessionManager.isActive()) {
            startActivity(Intent(this, DashboardActivity::class.java))
            finish()
            return
        }

        // Bloquear el botón atrás — el usuario no puede salir de la pantalla de login
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // No hacer nada — no se puede salir del login
            }
        })

        setContent {
            LoginScreen(
                onLoginSuccess = {
                    SessionManager.openSession()
                    startActivity(Intent(this, DashboardActivity::class.java))
                    finish()
                }
            )
        }
    }
}

@Composable
fun LoginScreen(onLoginSuccess: () -> Unit) {
    val context = LocalContext.current
    var showPinInput by remember { mutableStateOf(false) }
    var inputPin by remember { mutableStateOf("") }
    var lockoutTimeRemaining by remember { mutableLongStateOf(0L) }
    var warningText by remember { mutableStateOf("") }
    var showLanguageMenu by remember { mutableStateOf(false) }
    var langUpdateKey by remember { mutableIntStateOf(0) } // Forzar recomposición al cambiar de idioma

    fun updateLockoutState() {
        when (val state = PinManager.getLockoutState(context)) {
            is LockoutState.Locked -> {
                lockoutTimeRemaining = state.remainingMs
                warningText = LocaleManager.t("entry_blocked")
            }
            LockoutState.Open -> {
                lockoutTimeRemaining = 0
                if (warningText == LocaleManager.t("entry_blocked")) {
                    warningText = ""
                }
            }
        }
    }

    // Efecto secundario optimizado con corrutinas de Kotlin (cancela el loop automáticamente al salir)
    LaunchedEffect(Unit) {
        while (true) {
            updateLockoutState()
            if (lockoutTimeRemaining > 0) {
                delay(1000L)
            } else {
                delay(3000L)
            }
        }
    }

    // Colores Dark-mode Premium
    val navyDark = Color(0xFF0B192C)
    val navyMedium = Color(0xFF1E3E62)
    val accentOrange = Color(0xFFF1C40F)
    val alertRed = Color(0xFFC0392B)

    val scrollState = rememberScrollState()
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(showPinInput) {
        if (showPinInput) {
            delay(100L)
            try {
                focusRequester.requestFocus()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    // Dummy block para forzar la lectura del trigger de idioma y recomponer dinámicamente
    if (langUpdateKey >= 0) {
        if (!showPinInput) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(navyDark)
                    .padding(24.dp)
            ) {
                // Barra superior de iconos
                Row(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Selector de idioma (Mundo)
                    Box {
                        IconButton(
                            onClick = { showLanguageMenu = true },
                            modifier = Modifier
                                .size(48.dp)
                                .background(navyMedium.copy(alpha = 0.5f), shape = CircleShape)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Language,
                                contentDescription = "Idioma / Language / שפה",
                                tint = Color.White
                            )
                        }

                        DropdownMenu(
                            expanded = showLanguageMenu,
                            onDismissRequest = { showLanguageMenu = false },
                            modifier = Modifier.background(navyMedium)
                        ) {
                            DropdownMenuItem(
                                text = { Text("Español", color = Color.White) },
                                onClick = {
                                    LocaleManager.setLang(context, "es")
                                    langUpdateKey++
                                    showLanguageMenu = false
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("English", color = Color.White) },
                                onClick = {
                                    LocaleManager.setLang(context, "en")
                                    langUpdateKey++
                                    showLanguageMenu = false
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("עברית", color = Color.White) },
                                onClick = {
                                    LocaleManager.setLang(context, "he")
                                    langUpdateKey++
                                    showLanguageMenu = false
                                }
                            )
                        }
                    }

                    // Icono de configuración
                    IconButton(
                        onClick = { showPinInput = true },
                        modifier = Modifier
                            .size(48.dp)
                            .background(navyMedium.copy(alpha = 0.5f), shape = CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Settings,
                            contentDescription = LocaleManager.t("settings"),
                            tint = Color.White
                        )
                    }
                }

                // Logo central
                Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Image(
                        painter = painterResource(id = R.drawable.ic_logo),
                        contentDescription = "LockSuite Logo",
                        modifier = Modifier
                            .size(140.dp)
                            .clip(RoundedCornerShape(24.dp))
                            .background(navyMedium)
                            .padding(20.dp)
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                    Text(
                        text = LocaleManager.t("app_name"),
                        color = Color.White,
                        fontSize = 28.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = LocaleManager.t("active_protection"),
                        color = Color(0xFF2ECC71),
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center
                    )
                }
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(navyDark)
                    .verticalScroll(scrollState)
                    .focusRequester(focusRequester)
                    .focusable()
                    .onKeyEvent { keyEvent ->
                        if (keyEvent.type == KeyEventType.KeyDown) {
                            val isLocked = lockoutTimeRemaining > 0
                            if (isLocked) return@onKeyEvent false

                            when (keyEvent.key) {
                                Key.Backspace -> {
                                    if (inputPin.isNotEmpty()) {
                                        inputPin = inputPin.dropLast(1)
                                    }
                                    true
                                }
                                Key.Enter -> {
                                    if (inputPin.isNotEmpty()) {
                                        if (PinManager.verifyPin(context, inputPin)) {
                                            PinManager.resetAttempts(context)
                                            onLoginSuccess()
                                        } else {
                                            inputPin = ""
                                            when (val status = PinManager.recordFailedAttempt(context)) {
                                                LockoutStatus.LockedOut -> {
                                                    updateLockoutState()
                                                    Toast.makeText(context, LocaleManager.t("device_locked_5m"), Toast.LENGTH_LONG).show()
                                                }
                                                is LockoutStatus.Warning -> {
                                                    warningText = LocaleManager.t("incorrect_pin") + "${status.remainingAttempts}"
                                                }
                                            }
                                        }
                                    }
                                    true
                                }
                                Key.Escape -> {
                                    inputPin = ""
                                    true
                                }
                                else -> {
                                    val codePoint = keyEvent.utf16CodePoint
                                    if (codePoint > 0) {
                                        val char = codePoint.toChar()
                                        if (char.isDigit()) {
                                            if (inputPin.length < 16) {
                                                inputPin += char
                                            }
                                            true
                                        } else if (char == 'c' || char == 'C') {
                                            inputPin = ""
                                            true
                                        } else {
                                            false
                                        }
                                    } else {
                                        false
                                    }
                                }
                            }
                        } else {
                            false
                        }
                    }
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(32.dp)
            ) {
                // Barra superior con botón de regreso
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Start
                ) {
                    IconButton(
                        onClick = { showPinInput = false },
                        modifier = Modifier
                            .size(48.dp)
                            .background(navyMedium.copy(alpha = 0.5f), shape = CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.ArrowBack,
                            contentDescription = LocaleManager.t("back"),
                            tint = Color.White
                        )
                    }
                }

                // Cabecera con Logo
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.padding(top = 24.dp)
                ) {
                    Image(
                        painter = painterResource(id = R.drawable.ic_logo),
                        contentDescription = "LockSuite Logo",
                        modifier = Modifier
                            .size(100.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(navyMedium)
                            .padding(12.dp)
                    )
                    
                    Spacer(modifier = Modifier.height(16.dp))
                    
                    Text(
                        text = LocaleManager.t("app_name"),
                        color = Color.White,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    
                    if (lockoutTimeRemaining > 0) {
                        val sec = (lockoutTimeRemaining / 1000) % 60
                        val min = (lockoutTimeRemaining / 1000 / 60)
                        Text(
                            text = LocaleManager.t("try_again_in") + "%02d:%02d".format(min, sec),
                            color = alertRed,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center
                        )
                    } else {
                        Text(
                            text = LocaleManager.t("enter_pin"),
                            color = Color.LightGray,
                            fontSize = 16.sp,
                            textAlign = TextAlign.Center
                        )
                    }
                    
                    if (warningText.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = warningText,
                            color = if (lockoutTimeRemaining > 0) alertRed else accentOrange,
                            fontSize = 14.sp,
                            textAlign = TextAlign.Center
                        )
                    }
                }

                // Círculos del PIN
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val length = inputPin.length
                    val displayLength = if (length > 4) length else 4
                    for (i in 0 until displayLength) {
                        val filled = i < length
                        Box(
                            modifier = Modifier
                                .size(16.dp)
                                .padding(horizontal = 4.dp)
                                .clip(CircleShape)
                                .background(if (filled) accentOrange else navyMedium)
                        )
                    }
                }

                // Teclado Numérico
                Column(
                    modifier = Modifier.padding(bottom = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    val keys = listOf(
                        listOf("1", "2", "3"),
                        listOf("4", "5", "6"),
                        listOf("7", "8", "9"),
                        listOf("C", "0", "OK")
                    )

                    keys.forEach { row ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceEvenly
                        ) {
                            row.forEach { key ->
                                val isLocked = lockoutTimeRemaining > 0
                                Button(
                                    onClick = {
                                        if (isLocked) return@Button
                                        when (key) {
                                            "C" -> inputPin = ""
                                            "OK" -> {
                                                if (inputPin.isNotEmpty()) {
                                                    if (PinManager.verifyPin(context, inputPin)) {
                                                        PinManager.resetAttempts(context)
                                                        onLoginSuccess()
                                                    } else {
                                                        inputPin = ""
                                                        when (val status = PinManager.recordFailedAttempt(context)) {
                                                            LockoutStatus.LockedOut -> {
                                                                updateLockoutState()
                                                                Toast.makeText(context, LocaleManager.t("device_locked_5m"), Toast.LENGTH_LONG).show()
                                                            }
                                                            is LockoutStatus.Warning -> {
                                                                warningText = LocaleManager.t("incorrect_pin") + "${status.remainingAttempts}"
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            else -> {
                                                if (inputPin.length < 16) {
                                                    inputPin += key
                                                }
                                            }
                                        }
                                    },
                                    enabled = !isLocked,
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = if (key == "OK") accentOrange else navyMedium,
                                        contentColor = if (key == "OK") navyDark else Color.White,
                                        disabledContainerColor = navyMedium.copy(alpha = 0.3f),
                                        disabledContentColor = Color.Gray
                                    ),
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier
                                        .size(72.dp)
                                        .padding(4.dp)
                                ) {
                                    Text(
                                        text = key,
                                        fontSize = 18.sp,
                                        fontWeight = FontWeight.Bold,
                                        textAlign = TextAlign.Center
                                    )
                                }
                            }
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                    }
                }
            }
        }
    }
}
