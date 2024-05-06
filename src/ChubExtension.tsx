import {ReactElement} from "react";
import {Extension, ExtensionResponse, InitialData, Message} from "chub-extensions-ts";
import {LoadResponse} from "chub-extensions-ts/dist/types/load";
import {ImagineResponse} from "chub-extensions-ts/dist/types/generation/images";
type MessageStateType = {
    currentScene: string,
    inventory: string[],
    health: number,
    hunger: number,
    day: number,
    gameOver: boolean,
    song?: string | null
};
type ConfigType = {
    startingHealth: number,
    startingHunger: number,
    maxDays: number
};
type InitStateType = {
    world: { [scene: string]: {
            description: string,
            imagePrompt: string,
            connectedScenes: string[],
            items: string[],
            enemies: string[],
            puzzles: { [key: string]: { description: string, requiredItem: string, rewardScene: string } }
        }}
};
type ChatStateType = {
    image: { [key: string] : string | undefined }
};
export class ChubExtension extends Extension<InitStateType, ChatStateType, MessageStateType, ConfigType> {
    myInternalState: MessageStateType;
    config: ConfigType
    initState: InitStateType['world'] | null
    chatState: ChatStateType
    constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
        super(data);
        const {config, initState, messageState, chatState} = data;
        this.chatState = chatState != null ? chatState : {image: {}};
        this.config = config != null ? config : {startingHealth: 100, startingHunger: 0, maxDays: 365};
        this.initState = initState != null ? initState['world'] : null;
        this.myInternalState = messageState != null ? messageState : {
            currentScene: 'start',
            inventory: [],
            health: this.config.startingHealth != null ? this.config.startingHealth : 100,
            hunger: this.config.startingHunger != null ? this.config.startingHunger : 0,
            day: 1,
            gameOver: false
        };
    }

    async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
        const world = await this.generateWorld();
        this.initState = world;
        return {
            success: true,
            error: null,
            initState: {world},
            chatState: null
        };
    }

    async setState(state: MessageStateType): Promise<void> {
        this.myInternalState = {...this.myInternalState, ...state};
    }

    async beforePrompt(userMessage: Message): Promise<Partial<ExtensionResponse<ChatStateType, MessageStateType>>> {
        let {content} = userMessage;
        content = content.toLowerCase();

        let modifiedMessage = null;
        let systemMessage = null;

        if (this.myInternalState.gameOver) {
            if (content === 'restart') {
                this.myInternalState = {
                    currentScene: 'start',
                    inventory: [],
                    health: this.config.startingHealth,
                    hunger: this.config.startingHunger,
                    day: 1,
                    gameOver: false
                };
                modifiedMessage = "Game restarted. You wake up in the forest clearing once again.";
            } else {
                systemMessage = "The game has ended. Type 'restart' to play again.";
            }
        } else {
            if (content.startsWith('go ')) {
                const nextScene = content.slice(3);
                await this.handleGoCommand(nextScene);
            } else if (content.startsWith('take ')) {
                const item = content.slice(5);
                await this.handleTakeCommand(item);
            } else if (content.startsWith('use ')) {
                const item = content.slice(4);
                await this.handleUseCommand(item);
            } else if (content === 'fight') {
                await this.handleFightCommand();
            }

            await this.applyHungerDamage();
            await this.checkGameOver();
        }

        systemMessage = `${systemMessage ?? ''}\n\n${await this.getSceneInfo()}`;

        return {
            extensionMessage: null,
            messageState: this.myInternalState,
            modifiedMessage,
            systemMessage,
            error: null,
            chatState: this.chatState
        };
    }

    async afterResponse(botMessage: Message): Promise<Partial<ExtensionResponse<ChatStateType, MessageStateType>>> {
        let actions = [];
        if(this.myInternalState.gameOver) {
            actions.push('restart');
        }
        this.initState![this.myInternalState.currentScene].connectedScenes.forEach(scene => actions.push(`go ${scene}`));

        const currentScene = this.initState![this.myInternalState.currentScene];
        currentScene.items.forEach(item => actions.push(`take ${item}`));
        const currentEnemies = this.initState![this.myInternalState.currentScene].enemies;
        if (currentEnemies.length > 0) {
            actions.push('fight');
        }
        this.myInternalState.inventory.forEach(item => actions.push(`use ${item}`));
        let systemMessage = "```\nAvailable Commands:\n";
        systemMessage += `${actions.join(', ')}\n`;
        systemMessage += "```";
        return {
            extensionMessage: null,
            messageState: this.myInternalState,
            modifiedMessage: null,
            error: null,
            systemMessage,
            chatState: this.chatState
        };
    }

    async generateWorld(): Promise<InitStateType['world']> {
        const world: InitStateType['world'] = {
            start: {
                description: "You find yourself in a mysterious forest clearing. Paths lead north and east.",
                imagePrompt: "Mysterious fantasy forest clearing, path leading north and east, misty atmosphere",
                connectedScenes: ['forest_path', 'river'],
                items: ['stick'],
                enemies: [],
                puzzles: {}
            },
            forest_path: {
                description: "The forest path winds through dense trees. You spot something shiny on the ground.",
                imagePrompt: "Dense fantasy forest, winding path, shiny object on the ground",
                connectedScenes: ['start', 'forest_glade'],
                items: ['silver_key'],
                enemies: ['goblin'],
                puzzles: {}
            },
            river: {
                description: "A peaceful river flows past. A small boat is tied to the shore.",
                imagePrompt: "Calm river flowing through forest, small wooden boat tied to shore",
                connectedScenes: ['start', 'boat_ride'],
                items: ['fishing_pole'],
                enemies: [],
                puzzles: {}
            },
            forest_glade: {
                description: "You enter a sunny forest glade. There is an old stone well in the center.",
                imagePrompt: "Sunny forest clearing, ancient stone well in the center",
                connectedScenes: ['forest_path'],
                items: [],
                enemies: [],
                puzzles: {
                    well: {
                        description: "The well is locked. It requires a silver key.",
                        requiredItem: "silver_key",
                        rewardScene: "well_bottom"
                    }
                }
            },
            well_bottom: {
                description: "You descend to the bottom of the well. There is an old chest filled with treasure!",
                imagePrompt: "Dark stone well bottom, ancient treasure chest overflowing with gold coins and jewels",
                connectedScenes: ['forest_glade'],
                items: [],
                enemies: [],
                puzzles: {}
            },
            boat_ride: {
                description: "You drift down the river in the boat, enjoying the scenery.",
                imagePrompt: "Peaceful boat ride down fantasy river, lush forest on the banks",
                connectedScenes: ['river', 'river_end'],
                items: [],
                enemies: [],
                puzzles: {}
            },
            river_end: {
                description: "The river carries you to a distant shore. An ancient ruin stands before you.",
                imagePrompt: "Crumbling stone ruins on the shore of a river in a fantasy setting, mysterious atmosphere",
                connectedScenes: ['boat_ride', 'ruin_entrance'],
                items: [],
                enemies: ['skeleton'],
                puzzles: {}
            },
            ruin_entrance: {
                description: "You stand before the entrance to the ruins. A sturdy metal gate blocks your path.",
                imagePrompt: "Heavy, locked metal gate in front of ancient stone ruins",
                connectedScenes: ['river_end'],
                items: [],
                enemies: [],
                puzzles: {
                    gate: {
                        description: "The gate is locked. It looks like it could be opened with some kind of key.",
                        requiredItem: "gold_key",
                        rewardScene: "ruin_depths"
                    }
                }
            },
            ruin_depths: {
                description: "You venture deep into the ancient ruins and discover the lost treasure of the ancients!",
                imagePrompt: "Sunlight streaming into ancient ruins onto piles of gold treasure and artifacts",
                connectedScenes: ['ruin_entrance'],
                items: [],
                enemies: ['ancient_guardian'],
                puzzles: {}
            }
        };

        for (const scene in world) {
            this.generator.makeImage({prompt: world[scene].imagePrompt}).then(resp => {
                this.chatState.image[scene] = resp != null && resp.url != null ? resp.url : '';
            });
        }

        return world;
    }

    async handleGoCommand(nextScene: string) {
        if (this.initState![this.myInternalState.currentScene].connectedScenes.includes(nextScene)) {
            this.myInternalState.currentScene = nextScene;
            this.myInternalState.day++;
        } else {
            return `You can't go to ${nextScene} from here.`;
        }
    }

    async handleTakeCommand(item: string) {
        const currentScene = this.initState![this.myInternalState.currentScene];

        if (currentScene.items.includes(item)) {
            this.myInternalState.inventory.push(item);
            currentScene.items = currentScene.items.filter(i => i !== item);
            return `You take the ${item}.`;
        } else {
            return `There is no ${item} here to take.`;
        }
    }

    async handleUseCommand(item: string) {
        const currentPuzzles = this.initState![this.myInternalState.currentScene].puzzles;

        for (const puzzle in currentPuzzles) {
            if (currentPuzzles[puzzle].requiredItem === item && this.myInternalState.inventory.includes(item)) {
                this.myInternalState.inventory = this.myInternalState.inventory.filter(i => i !== item);
                this.myInternalState.currentScene = currentPuzzles[puzzle].rewardScene;
                delete this.initState![this.myInternalState.currentScene].puzzles[puzzle];
                return `You use the ${item} and solve the ${puzzle}!`;
            }
        }

        return `You can't use the ${item} here.`;
    }

    async handleFightCommand() {
        const currentEnemies = this.initState![this.myInternalState.currentScene].enemies;

        if (currentEnemies.length > 0) {
            const enemy = currentEnemies[0];
            this.initState![this.myInternalState.currentScene].enemies.shift();

            const damage = Math.floor(Math.random() * 20) + 10;
            this.myInternalState.health -= damage;

            if (this.myInternalState.inventory.includes('sword')) {
                return `You fight the ${enemy} with your sword. You take ${damage} damage and defeat it!`;
            } else {
                return `You fight the ${enemy} with your bare hands. You take ${damage} damage and defeat it, but you're hurt.`;
            }
        } else {
            return "There's nothing to fight here.";
        }
    }

    async applyHungerDamage() {
        this.myInternalState.hunger += 10;

        if (this.myInternalState.hunger >= 100) {
            this.myInternalState.health -= 20;
            this.myInternalState.hunger = 0;
        }
    }

    async checkGameOver() {
        if (this.myInternalState.health <= 0) {
            this.myInternalState.gameOver = true;
            return "You succumb to your wounds. Game over.";
        }

        if (this.myInternalState.day > this.config.maxDays) {
            this.myInternalState.gameOver = true;
            return "You fail to find the treasure in time. Game over.";
        }

        if (this.myInternalState.currentScene === 'ruin_depths') {
            this.myInternalState.gameOver = true;
            const song: ImagineResponse | null = await this.generator.makeMusic({
                prompt: "Triumphant orchestral fanfare",  lyrics: null, tags: ['orchestral', 'fanfare'],
                title: 'Ruin Depths', instrumental: true, lyrics_prompt: null,
            });
            this.myInternalState.song = song?.url;
            return "Congratulations, you found the ancient treasure! You win!";
        }
    }

    async getSceneInfo() {
        const scene = this.initState![this.myInternalState.currentScene];

        return `Day ${this.myInternalState.day}\nHealth: ${this.myInternalState.health}\nHunger: ${this.myInternalState.hunger}\nCurrent Scene: ${scene.description}\nAvailable Paths: ${scene.connectedScenes.join(', ')}\nItems Here: ${scene.items.join(', ')}\nEnemies Here: ${scene.enemies.join(', ')}\nInventory: ${this.myInternalState.inventory.join(', ')}\nPuzzles:\n${Object.values(scene.puzzles).map(p => - `${p.description}`).join('\n')}`;
    }

    render(): ReactElement {
        if(!this.initState) {
            return <></>
        }
        return <>
            <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                position: 'absolute',
                flexDirection: 'column',
                justifyContent: 'space-between'
            }}>

                {this.myInternalState.gameOver ? (
                    <div>Game Over. Type "restart" to play again.</div>
                ) : (
                    <div>
                        <h2>Day {this.myInternalState.day} - {this.initState![this.myInternalState.currentScene].description}</h2>
                        <p>Available
                            Paths: {this.initState![this.myInternalState.currentScene].connectedScenes.join(', ')}</p>
                        <p>Items Here: {this.initState![this.myInternalState.currentScene].items.join(', ')}</p>
                        <p>Enemies Here: {this.initState![this.myInternalState.currentScene].enemies.length == 0 ? 'None' : this.initState![this.myInternalState.currentScene].enemies.join(', ')}</p>
                    </div>
                )}
                <div>
                    <h3>Inventory</h3>
                    <ul>
                        {this.myInternalState.inventory.map(item => <li key={item}>{item}</li>)}
                    </ul>
                    <p>Health: {this.myInternalState.health}</p>
                    <p>Hunger: {this.myInternalState.hunger}</p>
                </div>
                {this.myInternalState.song != null && <audio src={this.myInternalState.song}/>}
            </div>
            <img
                src={this.chatState.image[this.myInternalState.currentScene]}
                alt="Scene"
                style={{
                    maxWidth: '100%', maxHeight: '50%', objectFit: 'contain',

                    opacity: '30%'
                }}
            />
        </>;
    }
}
