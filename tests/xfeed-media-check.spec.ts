import { test, expect } from '@playwright/test'

/**
 * Manual test to check if X Feed panel shows tweet media
 */

test.describe('X Feed Media Check', () => {
  test('navigate to X Feed and check for media rendering', async ({ page }) => {
    // Login first
    await page.goto('/login')

    // Fill in login form
    await page.fill('input[name="username"]', 'testadmin')
    await page.fill('input[name="password"]', 'testpass123')

    // Submit form
    await page.click('button[type="submit"]')

    // Wait for navigation to complete
    await page.waitForURL('/', { timeout: 10000 })

    // Wait for the page to load
    await page.waitForLoadState('networkidle')

    // Take a screenshot of the initial page
    await page.screenshot({ path: 'test-results/01-after-login.png', fullPage: true })

    // Look for navigation or panel controls - try to find X Feed panel
    // Check if there's a navigation menu
    const nav = await page.locator('nav, [role="navigation"]').first()
    await nav.screenshot({ path: 'test-results/02-navigation.png' })

    // Try to find and click X Feed link/button
    const xfeedButton = page.locator('text=/X Feed|Feed/i').first()
    if (await xfeedButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await xfeedButton.click()
      await page.waitForTimeout(1000)
    }

    // Wait for tweets to load
    await page.waitForSelector('[class*="rounded-lg"][class*="bg-card"]', { timeout: 10000 })

    // Check for images in tweet cards
    const images = await page.locator('img[alt="Tweet media"]').all()

    console.log(`Found ${images.length} tweet media images`)

    // Take screenshot of the feed
    await page.screenshot({ path: 'test-results/03-xfeed-panel.png', fullPage: true })

    // Check each image
    for (let i = 0; i < Math.min(images.length, 3); i++) {
      const img = images[i]
      const src = await img.getAttribute('src')
      const isVisible = await img.isVisible()

      console.log(`Image ${i + 1}:`)
      console.log(`  - src: ${src}`)
      console.log(`  - visible: ${isVisible}`)

      // Check if image has loaded
      const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth)
      const naturalHeight = await img.evaluate((el: HTMLImageElement) => el.naturalHeight)

      console.log(`  - dimensions: ${naturalWidth}x${naturalHeight}`)
      console.log(`  - loaded: ${naturalWidth > 0 && naturalHeight > 0}`)
    }

    // Check if any images are actually rendered
    expect(images.length).toBeGreaterThan(0)
  })
})
