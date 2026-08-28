package com.redsteadz.relaydeviceingress

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class EncryptedCapture(val ciphertext: ByteArray, val nonce: ByteArray)

internal class CaptureQueueCrypto {
  private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun alias(tenantId: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(tenantId.toByteArray())
    return "relay.capture." + digest.joinToString("") {
      (it.toInt() and 0xff).toString(16).padStart(2, '0')
    }
  }

  private fun key(tenantId: String): SecretKey {
    val alias = alias(tenantId)
    (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        alias,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
      ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return generator.generateKey()
  }

  fun encrypt(tenantId: String, envelopeId: String, plaintext: ByteArray): EncryptedCapture {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key(tenantId))
    cipher.updateAAD("$tenantId:$envelopeId".toByteArray())
    return EncryptedCapture(cipher.doFinal(plaintext), cipher.iv)
  }

  fun decrypt(tenantId: String, envelopeId: String, value: EncryptedCapture): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(tenantId), GCMParameterSpec(128, value.nonce))
    cipher.updateAAD("$tenantId:$envelopeId".toByteArray())
    return cipher.doFinal(value.ciphertext)
  }

  fun deleteKey(tenantId: String) = keyStore.deleteEntry(alias(tenantId))
}
