import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import {FormattedMessage} from 'react-intl';

import Modal from '../modal/modal.jsx';
import Button from '../button/button.jsx';
import {SORAX_DOWNLOAD_FILENAME, checkSoraxPassword, downloadSorax} from '../../lib/sorax-download.js';
// le projet Sorax lui-même, embarqué dans l'application (voir webpack.config.js)
import soraxProjectUrl from '../../../sorax/assets/export/nano/sorax-scratch.sb3';
import soraxIcon from './icon--sorax.svg';
import styles from './sorax-download.css';

/**
 * Bouton « download sorax », affiché juste à gauche du drapeau vert.
 * Un clic ouvre une petite fenêtre qui demande le mot de passe ; une fois le
 * mot de passe reconnu, le projet Sorax (`.sb3`) est téléchargé.
 */
class SoraxDownload extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            asking: false,
            password: '',
            error: null
        };
        this.handleOpen = this.handleOpen.bind(this);
        this.handleClose = this.handleClose.bind(this);
        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
    }
    handleOpen () {
        this.setState({
            asking: true,
            password: '',
            error: null
        });
    }
    handleClose () {
        this.setState({
            asking: false,
            password: '',
            error: null
        });
    }
    handleChange (e) {
        this.setState({
            password: e.target.value,
            error: null
        });
    }
    handleSubmit (e) {
        if (e) e.preventDefault();
        if (checkSoraxPassword(this.state.password)) {
            downloadSorax(this.props.url, SORAX_DOWNLOAD_FILENAME);
            this.handleClose();
            return;
        }
        this.setState({error: true});
    }
    handleKeyDown (e) {
        if (e.key === 'Enter') this.handleSubmit(e);
    }
    render () {
        if (!this.props.show) return null;
        return (
            <React.Fragment>
                <button
                    className={classNames(styles.soraxButton, this.props.className)}
                    title="Télécharger Sorax (mot de passe requis)"
                    type="button"
                    onClick={this.handleOpen}
                >
                    <img
                        className={styles.soraxIcon}
                        draggable={false}
                        src={soraxIcon}
                    />
                    <span className={styles.soraxLabel}>
                        <FormattedMessage
                            defaultMessage="download sorax"
                            description="Label of the button that downloads the Sorax project"
                            id="gui.soraxDownload.button"
                        />
                    </span>
                </button>
                {this.state.asking ? (
                    <Modal
                        contentLabel="Télécharger Sorax"
                        onRequestClose={this.handleClose}
                    >
                        <div className={styles.body}>
                            <p className={styles.intro}>
                                <FormattedMessage
                                    defaultMessage={'Sorax est encore en bêta : son mot de passe ' +
                                        'est réservé aux testeurs.'}
                                    description="Explanation in the Sorax download dialog"
                                    id="gui.soraxDownload.intro"
                                />
                            </p>
                            <label
                                className={styles.label}
                                htmlFor="sorax-password"
                            >
                                <FormattedMessage
                                    defaultMessage="Mot de passe"
                                    description="Label of the password field"
                                    id="gui.soraxDownload.password"
                                />
                            </label>
                            <input
                                autoFocus
                                className={styles.input}
                                id="sorax-password"
                                type="password"
                                value={this.state.password}
                                onChange={this.handleChange}
                                onKeyDown={this.handleKeyDown}
                            />
                            {this.state.error ? (
                                <p className={styles.error}>
                                    <FormattedMessage
                                        defaultMessage="Mot de passe incorrect."
                                        description="Shown when the Sorax password is wrong"
                                        id="gui.soraxDownload.wrong"
                                    />
                                </p>
                            ) : null}
                            <div className={styles.actions}>
                                <Button
                                    className={styles.action}
                                    onClick={this.handleClose}
                                >
                                    <FormattedMessage
                                        defaultMessage="Annuler"
                                        description="Cancel button of the Sorax download dialog"
                                        id="gui.soraxDownload.cancel"
                                    />
                                </Button>
                                <Button
                                    className={classNames(styles.action, styles.primary)}
                                    onClick={this.handleSubmit}
                                >
                                    <FormattedMessage
                                        defaultMessage="Télécharger"
                                        description="Confirm button of the Sorax download dialog"
                                        id="gui.soraxDownload.confirm"
                                    />
                                </Button>
                            </div>
                        </div>
                    </Modal>
                ) : null}
            </React.Fragment>
        );
    }
}

SoraxDownload.propTypes = {
    className: PropTypes.string,
    show: PropTypes.bool,
    url: PropTypes.string
};

SoraxDownload.defaultProps = {
    show: true,
    url: soraxProjectUrl
};

export default SoraxDownload;
