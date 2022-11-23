import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import moment from 'moment/min/moment-with-locales.js';

import lootTier from '../modules/loot-tier.mjs';
import progress from '../modules/progress-shard.mjs';
import { getBarters, getCrafts, getItems, getTraders, getHideout } from '../modules/game-data.mjs';
import { changeLanguage, t } from '../modules/translations.mjs';

const MAX_ITEMS = 2;

const defaultFunction = {
    data: new SlashCommandBuilder()
        .setName('price')
        .setDescription('Get an item\'s flea and trader value')
        .setNameLocalizations({
            'es-ES': 'precio',
            ru: 'цена',
        })
        .setDescriptionLocalizations({
            'es-ES': 'Obtenga el valor de pulgas y comerciante de un artículo',
            ru: 'Получите блоху предмета и ценность торговца',
        })
        .addStringOption(option => {
            return option.setName('name')
                .setDescription('Item name to search for')
                .setNameLocalizations({
                    'es-ES': 'nombre',
                    ru: 'имя',
                })
                .setDescriptionLocalizations({
                    'es-ES': 'Nombre del elemento a buscar',
                    ru: 'Название элемента для поиска',
                })
                .setAutocomplete(true)
                .setRequired(true);
        }),

    async execute(interaction) {
        await interaction.deferReply();
        // Get the search string from the user invoked command
        const searchString = interaction.options.getString('name');

        const [ items, traders, stations, barters, crafts ] = await Promise.all([
            getItems(interaction.locale),
            getTraders(interaction.locale),
            getHideout(interaction.locale),
            getBarters(),
            getCrafts(),
        ]);
        const matchedItems = items.filter(i => i.name.toLowerCase().includes(searchString.toLowerCase()));
        changeLanguage(interaction.locale);

        if (matchedItems.length === 0) {
            await interaction.deleteReply();
            await interaction.followUp({
                content: t('Found no results for "{{searchString}}"', {
                    searchString: searchString
                }),
                ephemeral: true,
            });
            return false;
        }

        let embeds = [];

        for (const item of matchedItems) {
            if (item.shortName.toLowerCase() === searchString) {
                matchedItems.length = 0;
                matchedItems.push(item);
                break;
            }
        }

        for (let i = 0; i < matchedItems.length; i = i + 1) {
            const item = matchedItems[i];
            const embed = new EmbedBuilder();

            let body = `**${t('Price and Item Details')}:**\n`;
            embed.setTitle(item.name);
            embed.setURL(item.link);
            moment.locale(interaction.locale);
            embed.setFooter({text: `🕑 ${t('Last Updated')}: ${moment(item.updated).fromNow()}`});

            const prog = await progress.getSafeProgress(interaction.user.id);

            embed.setThumbnail(item.iconLink);

            const size = parseInt(item.width) * parseInt(item.height);
            let bestTraderName = false;
            let bestTraderPrice = -1;

            for (const traderPrice of item.traderPrices) {
                if (traderPrice.priceRUB > bestTraderPrice) {
                    bestTraderPrice = traderPrice.priceRUB;
                    bestTraderName = traders.find(tr => tr.id === traderPrice.trader.id).name;
                }
            }

            let tierPrice = item.avg24hPrice;
            let tierFee = 0;
            let sellTo = t('Flea Market');
            if (item.avg24hPrice > 0) {
                tierFee = await progress.getFleaMarketFee(interaction.user.id, item.avg24hPrice, item.basePrice);
                //tierPrice -= avgFee;
                let fleaPrice = parseInt(item.avg24hPrice).toLocaleString() + "₽";

                if (size > 1) {
                    fleaPrice += "\r\n" + Math.round(parseInt(item.avg24hPrice) / size).toLocaleString() + `₽/${t('slot')}`;
                }
                fleaPrice += `\r\n\r\n ${t('Fee')}: ~${tierFee.toLocaleString()}₽`;
                fleaPrice += `\r\n ${t('Net')}: ${parseInt(item.avg24hPrice-tierFee).toLocaleString()}₽`;
                if (size > 1) {
                    fleaPrice += `\r\n ${Math.round(parseInt(item.avg24hPrice-tierFee) / size).toLocaleString()}₽/${t('slot')}`;
                }

                embed.addFields({name: t('Flea Price (avg)'), value: fleaPrice, inline: true});
            }

            if (item.lastLowPrice > 0) {
                const lowFee = await progress.getFleaMarketFee(interaction.user.id, item.lastLowPrice, item.basePrice);
                let fleaPrice = parseInt(item.lastLowPrice).toLocaleString() + "₽";

                if (size > 1) {
                    fleaPrice += "\r\n" + Math.round(parseInt(item.lastLowPrice) / size).toLocaleString() + `₽/${t('slot')}`;
                }
                fleaPrice += `\r\n\r\n ${t('Fee')}: ~${lowFee.toLocaleString()}₽`;
                fleaPrice += `\r\n ${t('Net')}: ${parseInt(item.lastLowPrice-lowFee).toLocaleString()}₽`;
                if (size > 1) {
                    fleaPrice += `\r\n ${Math.round(parseInt(item.lastLowPrice-lowFee) / size).toLocaleString()}₽/${t('slot')}`;
                }

                embed.addFields({name: t('Flea Price (low)'), value: fleaPrice, inline: true});
                
                if (item.lastLowPrice < tierPrice || tierPrice == 0) {
                    tierPrice = item.lastLowPrice;
                    tierFee = lowFee;
                }
            }

            const optimalPrice = await progress.getOptimalFleaPrice(interaction.user.id, item.basePrice);
            const optimalFee = await progress.getFleaMarketFee(interaction.user.id, optimalPrice, item.basePrice);
            if (optimalPrice - optimalFee > tierPrice - tierFee && optimalPrice < tierPrice) {
                tierPrice = optimalPrice;
                tierFee = optimalFee;

                let fleaPrice = parseInt(optimalPrice).toLocaleString() + "₽";

                if (size > 1) {
                    fleaPrice += "\r\n" + Math.round(parseInt(optimalPrice) / size).toLocaleString() + `₽/${t('slot')}`;
                }
                fleaPrice += `\r\n\r\n ${t('Fee')}: ~${optimalFee.toLocaleString()}₽`;
                fleaPrice += `\r\n ${t('Net')}: ${parseInt(optimalPrice-optimalFee).toLocaleString()}₽`;
                if (size > 1) {
                    fleaPrice += `\r\n ${Math.round(parseInt(optimalPrice-optimalFee) / size).toLocaleString()}₽/${t('slot')}`;
                }

                embed.addFields({name: t('Flea Price (optimal)'), value: fleaPrice, inline: true});
            }

            if (bestTraderName) {
                if (bestTraderPrice > (tierPrice - tierFee)) {
                    tierPrice = bestTraderPrice;
                    tierFee = 0;
                    sellTo = bestTraderName;
                }
                let traderVal = bestTraderPrice.toLocaleString() + "₽";

                if (size > 1) {
                    traderVal += "\r\n" + Math.round(bestTraderPrice / size).toLocaleString() + `₽/${t('slot')}`;
                }
                embed.addFields({name: bestTraderName + ` ${t('Value')}`, value: traderVal, inline: true});
            }

            body += `• ${t('Sell to')}: \`${sellTo}\` ${t('for')} \`${tierPrice.toLocaleString() + "₽"}\`\n`;

            // Calculate item tier
            let tier = lootTier(tierPrice / (item.width * item.height), item.types.includes('noFlea'));
            embed.setColor(tier.color);
            body += `• ${t('Item Tier')}: ${t(tier.msg)}\n`;

            for (const offer of item.buyFor) {
                if (!offer.vendor.trader) {
                    continue;
                }

                let traderPrice = offer.priceRUB.toLocaleString() + "₽";
                let level = 1;
                let quest = '';

                if (offer.vendor.minTraderLevel) {
                    level = offer.vendor.minTraderLevel;
                }
                if (offer.vendor.taskUnlock) {
                    quest = ` +${t('Task')}`;
                }

                const locked = prog.traders[offer.vendor.trader.id] < level ? '🔒' : '';
                const title = `${traders.find(tr => tr.id === offer.vendor.trader.id).name} ${t('LL')}${level}${quest} ${t('Price')}${locked}`;
                embed.addFields({name: title, value: traderPrice, inline: true});
            }

            for (const ib of item.bartersFor) {
                const barter = barters.find(b => b.id === ib.id);
                let barterCost = 0;

                for (const req of barter.requiredItems) {
                    const reqItem = items.find(it => it.id === req.item.id);
                    let itemCost = reqItem.avg24hPrice;

                    if (reqItem.lastLowPrice > itemCost && reqItem.lastLowPrice > 0) {
                        itemCost = reqItem.lastLowPrice;
                    }

                    for (const offer of reqItem.buyFor) {
                        if (!offer.vendor.trader) {
                            continue;
                        }

                        let traderPrice = offer.priceRUB;

                        if ((traderPrice < itemCost && prog.traders[offer.vendor.trader.id] >= offer.vendor.minTraderLevel) || itemCost == 0) {
                            itemCost = traderPrice;
                        }
                    }

                    let bestSellPrice = 0;
                    for (const offer of reqItem.sellFor) {
                        if (!offer.vendor.trader) {
                            continue;
                        }
                        if (offer.priceRUB > bestSellPrice) {
                            bestSellPrice = offer.priceRUB;
                        }
                    }

                    if (itemCost === 0) {
                        itemCost = bestSellPrice;
    
                        const isDogTag = req.attributes.some(att => att.name === 'minLevel');
                        if (isDogTag) {
                            const tagLevel = req.attributes.find(att => att.name === 'minLevel').value;
                            itemCost = bestSellPrice * tagLevel;
                        }
                    }

                    barterCost += itemCost * req.count;
                }

                barterCost = Math.round(barterCost / barter.rewardItems[0].count).toLocaleString() + "₽";
                const locked = prog.traders[barter.trader.id] < barter.level ? '🔒' : '';
                const title = `${traders.find(t => t.id === barter.trader.id).name} ${t('LL')}${barter.level} ${t('Barter')}${locked}`;
                embed.addFields({name: title, value: barterCost, inline: true});
            }

            for (const c of item.craftsFor) {
                const craft = crafts.find(cr => cr.id === c.id);
                let craftCost = 0;

                for (const req of craft.requiredItems) {
                    const reqItem = items.find(it => it.id === req.item.id);
                    let itemCost = reqItem.avg24hPrice;

                    if (reqItem.lastLowPrice > itemCost && reqItem.lastLowPrice > 0) {
                        itemCost = reqItem.lastLowPrice;
                    }

                    for (const offer of reqItem.buyFor) {
                        if (!offer.vendor.trader) {
                            continue;
                        }

                        let traderPrice = offer.priceRUB;

                        if ((traderPrice < itemCost && prog.traders[offer.vendor.trader.id] >= offer.vendor.minTraderLevel) || itemCost == 0) {
                            itemCost = traderPrice;
                        }
                    }
                    craftCost += itemCost * req.count;
                }
                craftCost = Math.round(craftCost / craft.rewardItems[0].count).toLocaleString() + "₽";
                if (craft.rewardItems[0].count > 1) {
                    craftCost += ' (' + craft.rewardItems[0].count + ')';
                }

                const locked = prog.hideout[craft.station.id] < craft.level ? '🔒' : '';
                const title = `${stations.find(s => s.id === craft.station.id).name} ${t('level')} ${craft.level} ${t('Craft')}${locked}`;
                embed.addFields({name: title, value: craftCost, inline: true});
            }

            if (embed.data.fields?.length == 0) {
                embed.setDescription(t('No prices available.'));
            }

            // Add the item weight
            try {
                body += `• ${t('Weight')}: \`${item.weight} ${t('kg')}\`\n`;
            } catch (e) {
                console.log(e);
                body += `• ${t('Weight')}: \`${t('failed to get item weight')}\`\n`;
            }
            

            // Add the item description
            embed.setDescription(body);

            embeds.push(embed);

            if (i >= MAX_ITEMS - 1) {
                break;
            }
        }

        if (MAX_ITEMS < matchedItems.length) {
            const ending = new EmbedBuilder();

            ending.setTitle("+" + (matchedItems.length - MAX_ITEMS) + ` ${t('more')}`);
            ending.setURL("https://tarkov.dev/?search=" + encodeURIComponent(searchString));

            let otheritems = '';
            for (let i = MAX_ITEMS; i < matchedItems.length; i = i + 1) {
                const item = matchedItems[i];
                const itemname = `[${matchedItems[i].name}](${matchedItems[i].link})`;

                if (itemname.length + 2 + otheritems.length > 2048) {
                    ending.setFooter({text: `${matchedItems.length-i} ${t('additional results not shown.')}`});

                    break;
                }

                otheritems += itemname + "\n";
            }

            ending.setDescription(otheritems);

            embeds.push(ending);
        }

        await interaction.editReply({ embeds: embeds });
    },
    examples: [
        '/price bitcoin'
    ]
};

export default defaultFunction;
