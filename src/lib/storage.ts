import { supabase } from '../api/client';

// 图片分类目录
export type ImageCategory = 'shop' | 'backgrounds' | 'pets' | 'questions';

// 上传图片到 Supabase Storage，返回公开 URL
export async function uploadImageToStorage(
  file: File | Blob,
  familyId: string,
  category: ImageCategory,
): Promise<string> {
  // 问题17: 使用 blob.type 判断格式，保留 PNG 透明背景
  const ext = file.type === 'image/png' ? 'png' : 'jpg';
  const filename = `${category}/${familyId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from('pet-images')
    .upload(filename, file, {
      contentType: file.type || 'image/jpeg',
      cacheControl: '3600',
    });
  if (error) throw error;

  const { data: { publicUrl } } = supabase.storage
    .from('pet-images')
    .getPublicUrl(filename);
  return publicUrl;
}

// 删除 Storage 中的图片（可选，用于清理）
export async function deleteImageFromStorage(path: string): Promise<void> {
  // 从完整 URL 提取 path
  try {
    const url = new URL(path);
    const parts = url.pathname.split('/');
    // /object/public/pet-images/shop/xxx/yyy.jpg → shop/xxx/yyy.jpg
    const idx = parts.indexOf('pet-images');
    if (idx < 0) return;
    const objectPath = parts.slice(idx + 1).join('/');
    if (!objectPath) return;
    const { error } = await supabase.storage.from('pet-images').remove([objectPath]);
    if (error) throw error;
  } catch {
    // URL 格式不对或非 Storage 路径，忽略
  }
}
