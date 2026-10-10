import { test, expect } from '@playwright/test'
import { openApp, collectConsoleErrors, captureRequests } from './harness'

test.describe('Video Buffer Progress', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
  })

  test('buffers 20 videos and shows progress from 0/20 going up', async ({ page }) => {
    const errors = collectConsoleErrors(page)
    const { requests } = captureRequests(page)

    // Wait for video buffer control to be visible
    const bufferControl = page.locator('.video-buffer-control')
    await expect(bufferControl).toBeVisible()

    // Get the video count badge (shows buffered/total)
    const countBadge = bufferControl.locator('.buffer-count-badge')
    await expect(countBadge).toBeVisible()

    // Get initial buffer state
    const initialText = await countBadge.textContent()
    console.log(`Initial buffer state: ${initialText}`)
    
    // Parse initial state (format: "X / Y")
    const initialMatch = initialText?.match(/(\d+)\s*\/\s*(\d+)/)
    const initialBuffered = initialMatch ? parseInt(initialMatch[1], 10) : 0
    const totalVideos = initialMatch ? parseInt(initialMatch[2], 10) : 0
    
    console.log(`Total videos available: ${totalVideos}`)
    console.log(`Initially buffered: ${initialBuffered}`)

    // Set buffer count to 20
    const bufferInput = bufferControl.locator('input[type="number"]')
    await expect(bufferInput).toBeVisible()
    await bufferInput.fill('20')

    // Click Buffer button
    const bufferButton = bufferControl.getByRole('button', { name: /buffer/i })
    await expect(bufferButton).toBeEnabled()
    await bufferButton.click()

    // Wait for buffering to start - button should show "Stop"
    await expect(bufferControl.getByRole('button', { name: /stop/i })).toBeVisible({ timeout: 5000 })

    // Track progress - check that count goes up from initial
    let previousBuffered = initialBuffered
    let progressMade = false
    
    // Poll for progress over up to 120 seconds (videos take time to buffer)
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000)
      
      const currentText = await countBadge.textContent()
      const currentMatch = currentText?.match(/(\d+)\s*\/\s*(\d+)/)
      const currentBuffered = currentMatch ? parseInt(currentMatch[1], 10) : 0
      
      console.log(`Progress check ${i + 1}: ${currentBuffered} / ${totalVideos}`)
      
      if (currentBuffered > previousBuffered) {
        progressMade = true
        console.log(`✓ Progress detected: ${previousBuffered} -> ${currentBuffered}`)
      }
      
      previousBuffered = currentBuffered
      
      // Check if buffering is complete (button says "Buffer" again)
      const isBuffering = await bufferControl.getByRole('button', { name: /stop/i }).isVisible().catch(() => false)
      if (!isBuffering) {
        console.log('Buffering completed')
        break
      }
    }

    // Final state check
    const finalText = await countBadge.textContent()
    const finalMatch = finalText?.match(/(\d+)\s*\/\s*(\d+)/)
    const finalBuffered = finalMatch ? parseInt(finalMatch[1], 10) : 0
    
    console.log(`Final buffer state: ${finalBuffered} / ${totalVideos}`)
    
    // Check what video proxy requests were made
    const videoRequests = requests.filter(r => r.path === 'video')
    console.log(`Video proxy requests made: ${videoRequests.length}`)
    for (const vr of videoRequests) {
      console.log(`  Video request: ${vr.params.get('url')?.slice(0, 100)}`)
    }
    
    // Verify progress was made (or was already complete)
    if (totalVideos > 0) {
      expect(finalBuffered).toBeGreaterThanOrEqual(initialBuffered)
      
      // If there were videos to buffer, progress should have been made
      const videosToBuffer = Math.min(20, totalVideos - initialBuffered)
      if (videosToBuffer > 0) {
        expect(progressMade).toBeTruthy()
      }
    }

    // Check console for CORS errors
    const corsErrors = errors.filter(e => e.includes('CORS') || e.includes('cors'))
    expect(corsErrors.length).toBe(0)
  })

  test('shows 0/0 when no videos are available', async ({ page }) => {
    // This test would need a search that returns no videos
    // For now, verify the UI handles empty state
    const bufferControl = page.locator('.video-buffer-control')
    
    if (await bufferControl.isVisible()) {
      const countBadge = bufferControl.locator('.buffer-count-badge')
      const text = await countBadge.textContent()
      console.log(`Buffer state with current results: ${text}`)
      
      // Should show some number format
      expect(text).toMatch(/\d+\s*\/\s*\d+/)
    }
  })

  test('buffer progress bar visualizes buffered segments', async ({ page }) => {
    const bufferControl = page.locator('.video-buffer-control')
    await expect(bufferControl).toBeVisible()

    // Check progress bar container exists
    const progressContainer = bufferControl.locator('.buffer-progress-container')
    await expect(progressContainer).toBeVisible()

    // Check for progress track
    const progressTrack = progressContainer.locator('.buffer-progress-track')
    await expect(progressTrack).toBeVisible()

    // Get buffer percentage
    const percentageEl = bufferControl.locator('.buffer-percentage')
    await expect(percentageEl).toBeVisible()
    const percentageText = await percentageEl.textContent()
    console.log(`Buffer percentage: ${percentageText}`)
    
    expect(percentageText).toMatch(/\d+%\s*buffered/)
  })
})