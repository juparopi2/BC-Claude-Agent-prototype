/**
 * Trigger a browser file download from a Blob
 * 
 * @param blob - The file content blob
 * @param filename - The name to save the file as
 */
export function triggerDownload(blob: Blob, filename: string): void {
  // Create object URL from blob
  const url = URL.createObjectURL(blob);
  
  // Create temporary link element
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  
  // Append to body, click, and remove
  document.body.appendChild(a);
  a.click();
  
  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
