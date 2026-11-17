import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardDefinition, CardVariant } from '../domain';
import { CardTile } from './App';

const card: CardDefinition = { id: 'set:final-fantasy:01-001', setId: 'set:final-fantasy', number: '01-001', name: 'Sample Hero', rarity: 'L' };
const variants: CardVariant[] = [
  { id: `${card.id}:normal`, cardId: card.id, name: 'Normal', treatment: 'normal', imageUrls: [{ url: 'https://example.com/normal.jpg', source: 'verified-remote' }] },
  { id: `${card.id}:foil`, cardId: card.id, name: 'Foil', treatment: 'foil', imageUrls: [{ url: 'https://example.com/foil.jpg', source: 'verified-remote' }], imageNote: 'Foil finish is not shown in this image.' },
  { id: `${card.id}:full-art`, cardId: card.id, name: 'Full Art', treatment: 'full-art', imageUrls: [{ url: 'https://example.com/full-art.jpg', source: 'verified-remote' }] },
];

afterEach(cleanup);

describe('Final Fantasy card tile versions', () => {
  it('labels the selected version, changes its image, and edits that version quantity', () => {
    const onQuantity = vi.fn();
    const onOpen = vi.fn();
    render(<CardTile card={card} inventory={[]} variants={variants} view="gallery" showStatus={false} itemLabel="card" onOpen={onOpen} onQuantity={onQuantity}/>);
    const tile = screen.getByRole('article');
    const versionGroup = within(tile).getByRole('group', { name: 'Sample Hero version' });

    expect(within(versionGroup).getByRole('button', { name: 'Show Normal version' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(tile).getByRole('img')).toHaveAttribute('alt', 'Sample Hero · Normal');
    expect(tile.querySelector('.card-image')).not.toHaveTextContent('Normal');

    fireEvent.click(within(versionGroup).getByRole('button', { name: 'Show Full Art version' }));
    expect(within(versionGroup).getByRole('button', { name: 'Show Full Art version' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(tile).getByRole('img')).toHaveAttribute('src', 'https://example.com/full-art.jpg');
    expect(within(tile).getByRole('img')).toHaveAttribute('alt', 'Sample Hero · Full Art');

    fireEvent.click(within(tile).getByRole('button', { name: 'Increase full art · personal' }));
    expect(onQuantity).toHaveBeenCalledWith(card, 'personal', 1, `${card.id}:full-art`);
    fireEvent.click(within(tile).getByRole('button', { name: 'Open card: Sample Hero, showing Full Art' }));
    expect(onOpen).toHaveBeenCalledWith(`${card.id}:full-art`);
  });

  it('shows when the foil finish is not visible in its catalog image', () => {
    render(<CardTile card={card} inventory={[]} variants={variants} view="gallery" showStatus={false} itemLabel="card" onOpen={vi.fn()} onQuantity={vi.fn()}/>);
    const tile = screen.getByRole('article');
    fireEvent.click(within(tile).getByRole('button', { name: 'Show Foil version' }));
    expect(within(tile).getByText('Foil finish not pictured')).toHaveAttribute('title', variants[1].imageNote);
    expect(within(tile).getByRole('button', { name: 'Increase foil · personal' })).toBeInTheDocument();
  });
});
