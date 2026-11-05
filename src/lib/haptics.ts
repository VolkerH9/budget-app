/**
 * A light tap of the Taptic Engine where the iPhone allows it.
 * Safari has no vibration API, but since iOS 18 it gives haptic feedback when a
 * switch control is toggled, so a hidden one is toggled. Must run inside a tap.
 */
export function haptic(): void {
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(10)
    return
  }
  const label = document.createElement('label')
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('switch', '')
  label.append(input)
  label.style.display = 'none'
  document.body.append(label)
  label.click()
  label.remove()
}
