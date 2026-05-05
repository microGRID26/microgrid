import { useEffect, useState } from 'react'
import { Image, Linking, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
// Use the legacy submodule for `cacheDirectory` + `downloadAsync`. These
// moved to a new Paths/File API in expo-file-system 19; the legacy namespace
// is still shipped and matches the pattern used by app/ticket/[id].tsx.
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { resolveSignedUrl } from '../lib/signed-url'
import { MgPressable } from './MgPressable'

interface Props {
  imagePath?: string | null
  imageUrl?: string | null
  message: string
  accentColor: string
  textColor: string
  textMutedColor: string
}

// Mobile equivalent of components/storage/TicketCommentAttachment.tsx on web.
// Resolves a signed URL for the attachment from image_path (preferred) or
// the legacy image_url. Post-bucket-flip, the raw image_url does not render
// because the ticket-attachments bucket is private.
export default function CommentAttachment({
  imagePath,
  imageUrl,
  message,
  accentColor,
  textColor,
  textMutedColor,
}: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!imagePath && !imageUrl) {
      setSignedUrl(null)
      return
    }
    let cancelled = false
    resolveSignedUrl('ticket-attachments', { path: imagePath, legacyUrl: imageUrl }).then(signed => {
      if (!cancelled) setSignedUrl(signed)
    })
    return () => {
      cancelled = true
    }
  }, [imagePath, imageUrl])

  // The image/file distinction comes from the stored path (or the legacy URL
  // filename), NOT the signed URL — the signed URL has query params that
  // would false-negative the regex below.
  const nameForTypeCheck = imagePath ?? imageUrl ?? ''
  const isImage = /\.(jpg|jpeg|png|webp|gif|heic)(\?|$)/i.test(nameForTypeCheck)
  const isFile = !isImage

  if (!signedUrl) return null

  if (isImage) {
    return (
      <Image
        source={{ uri: signedUrl }}
        style={{ width: 200, height: 200, borderRadius: 12 }}
        resizeMode="cover"
      />
    )
  }

  if (isFile) {
    return (
      <MgPressable
        accessibilityLabel="Download attached file"
        onPress={async () => {
          try {
            const ext = nameForTypeCheck.split('.').pop()?.split('?')[0] ?? 'file'
            const localUri = (FileSystem.cacheDirectory ?? '') + `attachment_${Date.now()}.${ext}`
            const { uri } = await FileSystem.downloadAsync(signedUrl, localUri)
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(uri)
            } else {
              Linking.openURL(signedUrl).catch(() => {})
            }
          } catch {
            Linking.openURL(signedUrl).catch(() => {})
          }
        }}
        activeOpacity={0.7}
        style={{ width: 220, paddingVertical: 6 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: accentColor + '20', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
            <Feather name="file-text" size={16} color={accentColor} />
          </View>
          <Feather name="download" size={14} color={accentColor} />
        </View>
        <Text style={{ fontSize: 13, color: textColor, fontFamily: 'Inter_500Medium' }} numberOfLines={2}>
          {(() => {
            const cleaned = message.replace(/📎\s*/, '').replace(/📷\s*/, '').trim()
            if (cleaned && cleaned !== 'Photo' && cleaned !== '[Photo attached]') return cleaned
            const urlParts = nameForTypeCheck.split('/')
            const rawName = urlParts[urlParts.length - 1]?.split('?')[0] ?? 'File'
            const ext = rawName.split('.').pop() ?? ''
            return ext ? `Document.${ext}` : 'Attached file'
          })()}
        </Text>
        <Text style={{ fontSize: 10, color: textMutedColor, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
          Tap to open file
        </Text>
      </MgPressable>
    )
  }

  return null
}
