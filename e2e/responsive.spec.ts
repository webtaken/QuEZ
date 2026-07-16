import { test, expect } from '@playwright/test'

const VIEWPORTS = [
  { name: 'phone', width: 360, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'projector', width: 1920, height: 1080 },
]

const PUBLIC_ROUTES = ['/', '/pricing', '/faq', '/blog', '/community', '/join', '/login']

for (const vp of VIEWPORTS) {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} has no horizontal overflow at ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(overflow.scrollWidth, 'page must not scroll horizontally').toBeLessThanOrEqual(
        overflow.clientWidth
      )
    })
  }
}
