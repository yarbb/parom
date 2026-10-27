<script lang="ts" module>
  import File from '@lucide/svelte/icons/file';
  import FileArchive from '@lucide/svelte/icons/file-archive';
  import FileBox from '@lucide/svelte/icons/file-box';
  import FileCode from '@lucide/svelte/icons/file-code';
  import FileCog from '@lucide/svelte/icons/file-cog';
  import FileImage from '@lucide/svelte/icons/file-image';
  import FileKey from '@lucide/svelte/icons/file-key';
  import FileMusic from '@lucide/svelte/icons/file-music';
  import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
  import FileTerminal from '@lucide/svelte/icons/file-terminal';
  import FileText from '@lucide/svelte/icons/file-text';
  import FileVideo from '@lucide/svelte/icons/file-video-camera';
  import Folder from '@lucide/svelte/icons/folder';
  import FolderSymlink from '@lucide/svelte/icons/folder-symlink';

  // Extension (lower case, no dot) to icon; everything else is a plain file.
  const byExtension: Record<string, typeof File> = {};
  const add = (icon: typeof File, exts: string) => exts.split(' ').forEach((e) => (byExtension[e] = icon));
  add(FileCode, 'lua luac js mjs cjs ts tsx jsx py rb php go rs c h cc cpp hpp cs java kt swift sh ps1 bat cmd html htm css scss vue svelte json jsonc xml yml yaml toml sql');
  add(FileImage, 'png jpg jpeg gif bmp webp svg ico tga vtf tif tiff psd');
  add(FileArchive, 'zip rar 7z tar gz tgz bz2 xz gma vpk pak');
  add(FileMusic, 'wav mp3 ogg flac m4a aac opus');
  add(FileVideo, 'mp4 webm mkv avi mov bik');
  add(FileText, 'txt md log csv rtf nfo');
  add(FileCog, 'cfg ini conf config properties env servercfg');
  add(FileKey, 'pem key crt cer pfx p12 pub');
  add(FileBox, 'mdl vvd vtx phy bsp nav ain dll so exe bin');
  add(FileSpreadsheet, 'xls xlsx ods db sqlite');
  add(FileTerminal, 'service');

  export function iconFor(name: string, dir: boolean, link = false): typeof File {
    if (dir) {
      return link ? FolderSymlink : Folder;
    }
    const dot = name.lastIndexOf('.');
    return (dot > 0 && byExtension[name.slice(dot + 1).toLowerCase()]) || File;
  }
</script>

<script lang="ts">
  // The icon in front of a name in the file lists.
  let { name, dir = false, link = false }: { name: string; dir?: boolean; link?: boolean } = $props();
  const Icon = $derived(iconFor(name, dir, link));
</script>

<span class="file-icon" class:dir aria-hidden="true"><Icon size={14} strokeWidth={1.6} /></span>

<style>
  .file-icon {
    display: inline-flex;
    flex: none;
    color: var(--muted);
  }

  .file-icon.dir {
    color: var(--text);
  }
</style>
