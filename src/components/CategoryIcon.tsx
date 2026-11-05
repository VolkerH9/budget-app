import {
  Baby, Beer, Bike, BookOpen, Briefcase, Bus, CarFront, Clapperboard, Coffee, Coins, Dog, Dumbbell, Fuel, Gamepad2, Gift,
  GraduationCap, Hamburger, HandCoins, HeartHandshake, HeartPulse, House, Landmark, Laptop, Lightbulb, Music, Package,
  PartyPopper, PiggyBank, Pill, Pizza, Plane, Popcorn, Receipt, Sandwich, Scissors, Shirt, ShoppingBag, ShoppingCart, Siren,
  Smartphone, Sparkles, SprayCan, SquareParking, Ticket, TrainFront, TreePalm, TrendingUp, Tv, Undo2, Users, Utensils, Wallet,
  Wifi, Wrench, type LucideIcon,
} from 'lucide-react'
import type { Category } from '../db'

/** The line icons a category can use, from the free Lucide set */
export const ICONS: Record<string, LucideIcon> = {
  'shopping-cart': ShoppingCart, hamburger: Hamburger, utensils: Utensils, coffee: Coffee, pizza: Pizza, sandwich: Sandwich,
  beer: Beer, 'spray-can': SprayCan, pill: Pill, 'heart-pulse': HeartPulse, scissors: Scissors, shirt: Shirt,
  'shopping-bag': ShoppingBag, dumbbell: Dumbbell, bike: Bike, clapperboard: Clapperboard, popcorn: Popcorn,
  'gamepad-2': Gamepad2, music: Music, ticket: Ticket, 'party-popper': PartyPopper, plane: Plane, 'tree-palm': TreePalm,
  gift: Gift, 'graduation-cap': GraduationCap, 'book-open': BookOpen, laptop: Laptop, tv: Tv, smartphone: Smartphone,
  wifi: Wifi, 'car-front': CarFront, fuel: Fuel, 'train-front': TrainFront, bus: Bus, 'square-parking': SquareParking,
  siren: Siren, house: House, lightbulb: Lightbulb, wrench: Wrench, dog: Dog, baby: Baby, 'heart-handshake': HeartHandshake,
  users: Users, 'hand-coins': HandCoins, 'undo-2': Undo2, briefcase: Briefcase, wallet: Wallet, coins: Coins,
  'trending-up': TrendingUp, 'piggy-bank': PiggyBank, landmark: Landmark, receipt: Receipt, package: Package, sparkles: Sparkles,
}

type Look = Pick<Category, 'emoji' | 'color'> & Partial<Pick<Category, 'icon' | 'symbol'>>

/** Line icon or emoji in a lightly tinted rounded square of the category colour */
export function CategoryIcon({ category, size = 34 }: { category?: Look; size?: number }) {
  const look = category ?? { emoji: '❔', color: '#8e8e93' }
  const Glyph = look.symbol !== 'emoji' && look.icon ? ICONS[look.icon] : undefined
  return (
    <span className="cat-icon" style={{ '--c': look.color, width: size, height: size, borderRadius: size * 0.27 } as React.CSSProperties} aria-hidden="true">
      {Glyph ? <Glyph size={size * 0.55} strokeWidth={1.8} /> : <span style={{ fontSize: size * 0.56 }}>{look.emoji}</span>}
    </span>
  )
}

/** Text form for places that cannot show an icon, such as a select menu */
export const categoryText = (c: Look & { name: string }) => (c.symbol === 'emoji' ? `${c.emoji} ${c.name}` : c.name)
